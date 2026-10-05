import { timingSafeEqual } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { RecordNotFound } from "../db/accounts";
import {
  dispatchIpaInstall,
  dispatchResultToJson,
  findIpaByFilename,
  ipaToJson,
  type DispatchDevice,
} from "../db/ipa";
import type { AppEnv } from "../http/context";
import { getPushIdentity, sendMdmNotification } from "../mdm/push";
import { ipaFiles, mdmDevices, mdmPushEndpoints } from "../schema";
import { parseStoredFileData } from "../storage/files";

/** Token-authenticated JSON API (ported from `ApiServer`). */
export const apiRoutes = new Hono<AppEnv>();

apiRoutes.use("/api/*", async (c, next) => {
  const expected = c.get("config").apiToken;
  if (!expected) {
    return c.json({ error: "MDM_API_TOKEN is not configured" }, 503);
  }
  const match = /^Bearer (.+)$/.exec(c.req.header("Authorization") ?? "");
  const provided = match?.[1] ?? "";
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(expectedBytes, providedBytes)) {
    return c.json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
  }
  await next();
});

apiRoutes.get("/api/v1/devices", async (c) => {
  const db = c.get("db");
  const devices = await db.select().from(mdmDevices).orderBy(asc(mdmDevices.serialNumber));
  return c.json({
    mdm_devices: devices.map((device) => ({ udid: device.udid, serial_number: device.serialNumber })),
  });
});

apiRoutes.get("/api/v1/ipa", async (c) => {
  const db = c.get("db");
  const baseUrl = c.get("config").baseUrl;
  const rows = await db.select().from(ipaFiles).orderBy(asc(ipaFiles.filename));
  return c.json({ ipa_files: rows.map((row) => ipaToJson(baseUrl, row)) });
});

apiRoutes.get("/api/v1/ipa/:filename", async (c) => {
  const db = c.get("db");
  try {
    const row = await findIpaByFilename(db, c.req.param("filename"));
    return c.json(ipaToJson(c.get("config").baseUrl, row));
  } catch (error) {
    if (error instanceof RecordNotFound) {
      return c.json({ error: "not found" }, 404);
    }
    throw error;
  }
});

apiRoutes.put("/api/v1/ipa/:filename", async (c) => {
  const db = c.get("db");
  const fileStore = c.get("fileStore");
  let row;
  try {
    row = await findIpaByFilename(db, c.req.param("filename"));
  } catch (error) {
    if (error instanceof RecordNotFound) {
      return c.json({ error: "not found" }, 404);
    }
    throw error;
  }

  const form = await c.req.parseBody();
  const assetFile = form.asset_file;
  if (!(assetFile instanceof File)) {
    return c.json({ error: "asset_file is required" }, 400);
  }
  const bytes = new Uint8Array(await assetFile.arrayBuffer());
  const stored = await fileStore.upload({
    bytes,
    filename: assetFile.name,
    contentType: assetFile.type || undefined,
  });
  const oldStored = parseStoredFileData(row.assetFileData);
  const bundleIdentifier =
    typeof form.bundle_identifier === "string" && form.bundle_identifier.length > 0
      ? form.bundle_identifier
      : row.bundleIdentifier;
  const [updated] = await db
    .update(ipaFiles)
    .set({
      filename: assetFile.name,
      bundleIdentifier,
      assetFileData: JSON.stringify({
        id: stored.key,
        storage: stored.storage,
        metadata: {
          filename: stored.metadata.filename,
          size: stored.metadata.size,
          mime_type: stored.metadata.mimeType,
        },
      }),
      updatedAt: new Date(),
    })
    .where(eq(ipaFiles.id, row.id))
    .returning();
  await fileStore.deleteStored(oldStored);
  return c.json(ipaToJson(c.get("config").baseUrl, updated!));
});

apiRoutes.post("/api/v1/ipa/:filename/install", async (c) => {
  const db = c.get("db");
  const config = c.get("config");
  let row;
  try {
    row = await findIpaByFilename(db, c.req.param("filename"));
  } catch (error) {
    if (error instanceof RecordNotFound) {
      return c.json({ error: "not found" }, 404);
    }
    throw error;
  }

  const bodyText = await c.req.text();
  let payload: Record<string, unknown> = {};
  if (bodyText.length > 0) {
    try {
      payload = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
  }
  const udids = (Array.isArray(payload.udids) ? payload.udids : []).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const devices =
    udids.length === 0
      ? []
      : await db.select().from(mdmDevices).where(inArray(mdmDevices.udid, udids));
  const endpoints = new Map<string, { token: string; pushMagic: string }>();
  for (const device of devices) {
    const [endpoint] = await db
      .select()
      .from(mdmPushEndpoints)
      .where(eq(mdmPushEndpoints.mdmDeviceId, device.id))
      .limit(1);
    if (endpoint) {
      endpoints.set(device.udid, { token: endpoint.token, pushMagic: endpoint.pushMagic });
    }
  }
  const dispatchDevices: DispatchDevice[] = devices.map((device) => ({
    kind: "mdm",
    udid: device.udid,
    serialNumber: device.serialNumber,
  }));
  const identity = getPushIdentity(config);
  const sendPush =
    c.get("sendPush") ?? ((endpoint: { token: string; pushMagic: string }) =>
      sendMdmNotification(identity, endpoint));
  const result = await dispatchIpaInstall(db, {
    filename: row.filename,
    devices: dispatchDevices,
    baseUrl: config.baseUrl,
    pushEndpoints: endpoints,
    sendPush,
  });
  const unknown = udids.filter((udid) => !devices.some((device) => device.udid === udid));
  return c.json({ ...dispatchResultToJson(result), unknown_udids: unknown });
});
