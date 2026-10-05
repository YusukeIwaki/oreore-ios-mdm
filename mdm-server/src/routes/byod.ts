import { Hono } from "hono";
import {
  createAccessToken,
  findAccountByEmail,
  findTokenUsage,
  recordTokenUsage,
  TokenUsageConflict,
} from "../db/accounts";
import {
  handleByodAuthenticate,
  handleByodCheckOut,
  handleByodTokenUpdate,
} from "../db/checkin";
import { findByodDeviceByEnrollmentId } from "../db/devices";
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
import { buildPlist, parsePlist } from "../mdm/plist";
import { mdmByodEnrollmentProfile } from "../mdm/mobileconfig";
import { getPushIdentity } from "../mdm/push";
import { byodResponseHandler } from "../mdm/responses";
import { AuthenticatePage } from "../views/authenticate";

/** User Enrollment / BYOD (ported from `MdmByodServer`). */
export const byodRoutes = new Hono<AppEnv>();

// NOTE: no FixContentTypeMiddleware equivalent — Hono never parses request
// bodies implicitly, so the iOS 15 form-urlencoded quirk cannot crash us.

byodRoutes.post("/mdm-byod/enroll", async (c) => {
  const db = c.get("db");
  const config = c.get("config");
  const account = await authorizedAccount(db, c);
  if (!account) {
    return bearerChallenge(config.baseUrl, "/mdm-byod/authenticate");
  }
  if (!config.deviceP12Der) {
    throw new Error("DEVICE_CERTIFICATE_BASE64 is not configured");
  }
  const target = await firstGetTokenTarget(db);
  const payload = mdmByodEnrollmentProfile({
    payloadUuid: config.payloadUuid,
    topic: getPushIdentity(config).topic,
    deviceP12Der: config.deviceP12Der,
    baseUrl: config.baseUrl,
    hasGetTokenTarget: target !== null,
    assignedManagedAppleId: account.email,
  });
  return c.body(buildPlist(payload), 200, { "Content-Type": "application/x-apple-aspen-config" });
});

byodRoutes.get("/mdm-byod/authenticate", async (c) => {
  const db = c.get("db");
  const userIdentifier = c.req.query("user-identifier");
  const email = c.req.query("email") ?? "";
  const accounts = await db.select({ email: managedAppleAccounts.email }).from(managedAppleAccounts);
  if (email !== "") {
    await findAccountByEmail(db, email);
  }
  return c.html(AuthenticatePage({ mode: "byod", userIdentifier, email, accounts: accounts.map((a) => a.email) }));
});

byodRoutes.post("/mdm-byod/authenticate", async (c) => {
  const db = c.get("db");
  const form = await c.req.parseBody();
  const account = await findAccountByEmail(db, String(form.email ?? ""));
  if (form.password === "password!") {
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
      mode: "byod",
      email: account.email,
      accounts: accounts.map((a) => a.email),
      error: "Invalid password",
    }),
  );
});

byodRoutes.put("/mdm-byod/checkin", async (c) => {
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
      deviceIdentifier: plist.EnrollmentID as string,
      serviceType: "com.apple.maid",
      depKeyPem: config.depKeyPem,
    });
    return c.body(buildPlist({ TokenData: Buffer.from(token, "utf8") }), 200, {
      "Content-Type": "application/xml",
    });
  }

  const token = await currentAccessToken(db, c);
  if (plist.MessageType === "CheckOut" && token) {
    const usage = await findTokenUsage(db, token.id, plist.EnrollmentID as string);
    if (!usage) {
      return bearerChallenge(config.baseUrl, "/mdm-byod/authenticate");
    }
  } else {
    const account = await authorizedAccount(db, c);
    if (!account) {
      return bearerChallenge(config.baseUrl, "/mdm-byod/authenticate");
    }
  }

  if (plist.Topic !== getPushIdentity(config).topic) {
    return c.text("Topic mismatch", 403);
  }

  const enrollmentId = plist.EnrollmentID;
  if (typeof enrollmentId === "string" && enrollmentId.length > 0 && token) {
    try {
      await recordTokenUsage(db, token.id, enrollmentId);
    } catch (error) {
      if (error instanceof TokenUsageConflict) {
        return c.text("Access token is already used by another device", 400);
      }
      throw error;
    }
  }

  switch (plist.MessageType) {
    case "Authenticate":
      await handleByodAuthenticate(db, plist);
      break;
    case "TokenUpdate":
      await handleByodTokenUpdate(db, plist);
      break;
    case "CheckOut":
      await handleByodCheckOut(db, plist);
      break;
    default:
      throw new Error(`Unknown MessageType: ${String(plist.MessageType)}`);
  }
  return c.text("OK");
});

byodRoutes.put("/mdm-byod/command", async (c) => {
  const db = c.get("db");
  const config = c.get("config");
  const account = await authorizedAccount(db, c);
  if (!account) {
    return bearerChallenge(config.baseUrl, "/mdm-byod/authenticate");
  }
  const plist = parsePlist(await c.req.text()) as Record<string, unknown>;
  const enrollmentId = plist.EnrollmentID;
  const status = plist.Status;
  if (typeof enrollmentId !== "string" || typeof status !== "string") {
    return c.text("Bad request", 400);
  }

  const token = await currentAccessToken(db, c);
  if (token) {
    try {
      await recordTokenUsage(db, token.id, enrollmentId);
    } catch (error) {
      if (error instanceof TokenUsageConflict) {
        return c.text("Access token is already used by another device", 400);
      }
      throw error;
    }
  }

  const device = await findByodDeviceByEnrollmentId(db, enrollmentId);
  const commandUuid = plist.CommandUUID;

  let handling: HandlingRequest | null = null;
  if (status !== "Idle" && typeof commandUuid === "string") {
    try {
      handling = await dequeueHandlingRequest(db, enrollmentId, commandUuid);
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
    const handler = requestType ? byodResponseHandler(`${requestType}${status}`) : undefined;
    if (handler) {
      if (status === "Error") {
        handler(device, plist.ErrorChain);
      } else {
        // NOTE: strips UDID (not EnrollmentID), exactly like the Ruby handler.
        const { Status, UDID, CommandUUID, ErrorChain, ...responsePayload } = plist;
        void Status;
        void UDID;
        void CommandUUID;
        void ErrorChain;
        handler(device, responsePayload);
      }
    }
  }

  const command = await dequeueCommand(db, enrollmentId);
  if (status === "NotNow" && handling) {
    await enqueueCommand(db, enrollmentId, parsePlist(handling.requestPayloadXml));
  }

  if (command) {
    return c.body(buildPlist(command), 200, { "Content-Type": "application/xml" });
  }
  return c.body("", 200);
});
