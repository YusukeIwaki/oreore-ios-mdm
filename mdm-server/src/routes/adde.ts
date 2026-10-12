import { Hono } from "hono";
import {
  createAccessToken,
  findAccountByEmail,
  findTokenUsage,
  recordTokenUsage,
  TokenUsageConflict,
} from "../db/accounts";
import { handleAuthenticate, handleCheckOut, handleTokenUpdate } from "../db/checkin";
import { declarationInputFor, logSync404, logSyncResponse } from "../db/ddm";
import { findMdmDeviceByUdid } from "../db/devices";
import { firstGetTokenTarget, findOrGenerateGetToken } from "../db/gettoken";
import {
  dequeueCommand,
  dequeueHandlingRequest,
  enqueueCommand,
  HandlingRequestNotFound,
  logCommandResult,
  type HandlingRequest,
} from "../db/queue";
import type { AppEnv } from "../http/context";
import { authorizedAccount, bearerChallenge, currentAccessToken } from "../http/mdmAuth";
import { managedAppleAccounts } from "../schema";
import { Declaration } from "../ddm/declaration";
import { handleDeclarationRequest, RouteNotFound } from "../ddm/router";
import { buildPlist, dataToBuffer, parsePlist } from "../mdm/plist";
import { mdmAddeEnrollmentProfile } from "../mdm/mobileconfig";
import { getPushIdentity } from "../mdm/push";
import { mdmResponseHandler } from "../mdm/responses";
import { AuthenticatePage } from "../views/authenticate";
import { assetFilesUrl, parseStoredFileData } from "../storage/files";

/** Account-driven Device Enrollment / ADDE (ported from `MdmAddeServer`). */
export const addeRoutes = new Hono<AppEnv>();

addeRoutes.post("/mdm-adde/enroll", async (c) => {
  const db = c.get("db");
  const config = c.get("config");
  const account = await authorizedAccount(db, c);
  if (!account) {
    return bearerChallenge(config.baseUrl, "/mdm-adde/authenticate");
  }
  if (!config.deviceP12Der) {
    throw new Error("DEVICE_CERTIFICATE_BASE64 is not configured");
  }
  const target = await firstGetTokenTarget(db);
  const payload = mdmAddeEnrollmentProfile({
    payloadUuid: config.payloadUuid,
    topic: getPushIdentity(config).topic,
    deviceP12Der: config.deviceP12Der,
    baseUrl: config.baseUrl,
    hasGetTokenTarget: target !== null,
    assignedManagedAppleId: account.email,
  });
  return c.body(buildPlist(payload), 200, { "Content-Type": "application/x-apple-aspen-config" });
});

addeRoutes.get("/mdm-adde/authenticate", async (c) => {
  const db = c.get("db");
  const userIdentifier = c.req.query("user-identifier");
  const email = c.req.query("email") ?? "";
  const accounts = await db.select({ email: managedAppleAccounts.email }).from(managedAppleAccounts);
  if (email !== "") {
    await findAccountByEmail(db, email);
  }
  return c.html(AuthenticatePage({ mode: "adde", userIdentifier, email, accounts: accounts.map((a) => a.email) }));
});

addeRoutes.post("/mdm-adde/authenticate", async (c) => {
  const db = c.get("db");
  const form = await c.req.parseBody();
  const account = await findAccountByEmail(db, String(form.email ?? ""));
  if (form.password === "PASSWORD!") {
    const token = await createAccessToken(db, account.id);
    return new Response("Redirect", {
      status: 308,
      headers: {
        Location: `apple-remotemanagement-user-login://authentication-results?access-token=${token.token}`,
      },
    });
  }
  const accounts = await db.select({ email: managedAppleAccounts.email }).from(managedAppleAccounts);
  return c.html(
    AuthenticatePage({
      mode: "adde",
      email: account.email,
      accounts: accounts.map((a) => a.email),
      error: "Invalid password",
    }),
  );
});

addeRoutes.put("/mdm-adde/checkin", async (c) => {
  const db = c.get("db");
  const config = c.get("config");
  const plist = parsePlist(await c.req.text()) as Record<string, unknown>;

  if (plist.MessageType === "GetToken") {
    const target = await firstGetTokenTarget(db);
    if (!target || plist.TokenServiceType !== "com.apple.maid") {
      return c.text("Not supported yet", 400);
    }
    if (!config.depKeyPem) {
      throw new Error("DEP_KEY_BASE64 is not configured");
    }
    const token = await findOrGenerateGetToken(db, {
      serverUuid: target.serverUuid,
      deviceIdentifier: plist.UDID as string,
      serviceType: "com.apple.maid",
      depKeyPem: config.depKeyPem,
    });
    return c.body(buildPlist({ TokenData: Buffer.from(token, "utf8") }), 200, {
      "Content-Type": "application/xml",
    });
  }

  const token = await currentAccessToken(db, c);
  if (plist.MessageType === "CheckOut" && token) {
    const usage = await findTokenUsage(db, token.id, plist.UDID as string);
    if (!usage) {
      return bearerChallenge(config.baseUrl, "/mdm-adde/authenticate");
    }
  } else {
    const account = await authorizedAccount(db, c);
    if (!account) {
      return bearerChallenge(config.baseUrl, "/mdm-adde/authenticate");
    }
  }

  if (plist.MessageType === "DeclarativeManagement") {
    const endpoint = plist.Endpoint;
    if (typeof endpoint !== "string" || endpoint.length === 0) {
      return c.text("Bad request", 400);
    }
    const udid = plist.UDID as string;
    const device = await findMdmDeviceByUdid(db, udid);
    const data =
      plist.Data === undefined || plist.Data === null
        ? null
        : (JSON.parse(Buffer.from(dataToBuffer(plist.Data)).toString("utf8")) as unknown);
    const input = await declarationInputFor(db, device.serialNumber, (_assetName, assetFileData) =>
      assetFilesUrl(config.baseUrl, parseStoredFileData(assetFileData)),
    );
    const declaration = new Declaration(input);
    try {
      const response = handleDeclarationRequest(endpoint, data, () => declaration);
      await logSyncResponse(db, udid, endpoint, data, response);
      return c.json(response);
    } catch (error) {
      if (error instanceof RouteNotFound) {
        await logSync404(db, udid, endpoint, data);
        return c.text("Not found", 404);
      }
      throw error;
    }
  }

  if (plist.Topic !== getPushIdentity(config).topic) {
    return c.text("Topic mismatch", 403);
  }

  const udid = plist.UDID;
  if (typeof udid === "string" && udid.length > 0 && token) {
    try {
      await recordTokenUsage(db, token.id, udid);
    } catch (error) {
      if (error instanceof TokenUsageConflict) {
        return c.text("Access token is already used by another device", 400);
      }
      throw error;
    }
  }

  switch (plist.MessageType) {
    case "Authenticate":
      await handleAuthenticate(db, plist);
      break;
    case "TokenUpdate":
      await handleTokenUpdate(db, plist);
      break;
    case "CheckOut":
      await handleCheckOut(db, plist);
      break;
    default:
      throw new Error(`Unknown MessageType: ${String(plist.MessageType)}`);
  }
  return c.text("OK");
});

addeRoutes.put("/mdm-adde/command", async (c) => {
  const db = c.get("db");
  const config = c.get("config");
  const account = await authorizedAccount(db, c);
  if (!account) {
    return bearerChallenge(config.baseUrl, "/mdm-adde/authenticate");
  }
  const plist = parsePlist(await c.req.text()) as Record<string, unknown>;
  const udid = plist.UDID;
  const status = plist.Status;
  if (typeof udid !== "string" || typeof status !== "string") {
    return c.text("Bad request", 400);
  }

  const token = await currentAccessToken(db, c);
  if (token) {
    try {
      await recordTokenUsage(db, token.id, udid);
    } catch (error) {
      if (error instanceof TokenUsageConflict) {
        return c.text("Access token is already used by another device", 400);
      }
      throw error;
    }
  }

  const device = await findMdmDeviceByUdid(db, udid);
  const commandUuid = plist.CommandUUID;

  let handling: HandlingRequest | null = null;
  if (status !== "Idle" && typeof commandUuid === "string") {
    try {
      handling = await dequeueHandlingRequest(db, udid, commandUuid);
      await logCommandResult(db, handling, plist);
    } catch (error) {
      if (error instanceof HandlingRequestNotFound) {
        console.warn(`CommandUUID not in DB: ${JSON.stringify(plist)}`);
      } else {
        throw error;
      }
    }
  }

  if ((status === "Acknowledged" || status === "Error") && handling) {
    const request = parsePlist(handling.requestPayloadXml) as {
      Command?: { RequestType?: string };
    };
    const requestType = request.Command?.RequestType;
    const handler = requestType ? mdmResponseHandler(`${requestType}${status}`) : undefined;
    if (handler) {
      if (status === "Error") {
        handler(device, plist.ErrorChain);
      } else {
        const { Status, UDID, CommandUUID, ErrorChain, ...responsePayload } = plist;
        void Status;
        void UDID;
        void CommandUUID;
        void ErrorChain;
        handler(device, responsePayload);
      }
    }
  }

  const command = await dequeueCommand(db, udid);
  if (status === "NotNow" && handling) {
    await enqueueCommand(db, udid, parsePlist(handling.requestPayloadXml));
  }

  if (command) {
    return c.body(buildPlist(command), 200, { "Content-Type": "application/xml" });
  }
  return c.body("", 200);
});
