import { Hono } from "hono";
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
import { Declaration } from "../ddm/declaration";
import { handleDeclarationRequest, RouteNotFound } from "../ddm/router";
import { buildPlist, dataToBuffer, parsePlist } from "../mdm/plist";
import { getPushIdentity } from "../mdm/push";
import { mdmResponseHandler } from "../mdm/responses";
import { assetFilesUrl, parseStoredFileData } from "../storage/files";

/** Device Enrollment MDM protocol (ported from `MdmServer`). */
export const mdmRoutes = new Hono<AppEnv>();

mdmRoutes.put("/mdm/checkin", async (c) => {
  const db = c.get("db");
  const config = c.get("config");
  const plist = parsePlist(await c.req.text()) as Record<string, unknown>;
  const messageType = plist.MessageType;

  if (messageType === "DeclarativeManagement") {
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

  if (messageType === "GetToken") {
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

  if (plist.Topic !== getPushIdentity(config).topic) {
    return c.text("Topic mismatch", 403);
  }

  switch (messageType) {
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
      throw new Error(`Unknown MessageType: ${String(messageType)}`);
  }
  return c.text("OK");
});

mdmRoutes.put("/mdm/command", async (c) => {
  const db = c.get("db");
  const plist = parsePlist(await c.req.text()) as Record<string, unknown>;
  const udid = plist.UDID;
  const status = plist.Status;
  if (typeof udid !== "string" || typeof status !== "string") {
    return c.text("Bad request", 400);
  }
  const commandUuid = plist.CommandUUID;
  if (typeof commandUuid !== "string" && status !== "Idle") {
    console.warn(`CommandUUID missing in response: ${JSON.stringify(plist)}`);
  }

  const device = await findMdmDeviceByUdid(db, udid);

  let handling: HandlingRequest | null = null;
  if (status !== "Idle" && typeof commandUuid === "string") {
    try {
      handling = await dequeueHandlingRequest(db, udid, commandUuid);
      await logCommandResult(db, handling, plist);
    } catch (error) {
      if (error instanceof HandlingRequestNotFound) {
        // iOS sometimes retries MDM responses already handled.
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
