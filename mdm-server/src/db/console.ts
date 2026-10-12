import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import type { Database } from "../db";
import * as schema from "../schema";
import { buildPlist, parsePlist } from "../mdm/plist";
import { installProfile } from "../mdm/commands";
import { enqueueCommand } from "./queue";
import { RecordNotFound } from "./accounts";
import { assertPresent, parseIdParam } from "./ddm_admin";
import { parseVppToken } from "../vpp/token";
import { decryptDepToken } from "../dep/token";
import { DepClient } from "../dep/client";
import {
  FileStore,
  formatStoredFileData,
  parseStoredFileData,
  type UploadedFile,
} from "../storage/files";

export { RecordNotFound };
export { findMdmDeviceByUdid, findByodDeviceByEnrollmentId as findByodDeviceByEnrollment } from "./devices";

/** Enqueue a raw plist command pasted into the admin textarea. */
export async function enqueueTextareaCommand(
  db: Database,
  deviceIdentifier: string,
  payloadText: string | undefined,
): Promise<boolean> {
  if (!payloadText || payloadText.trim() === "") {
    return false;
  }
  const parsed = parsePlist(payloadText);
  await enqueueCommand(db, deviceIdentifier, parsed);
  return true;
}

/** InstallProfile command payload for an uploaded .mobileconfig (no trailing newline). */
export function installProfilePayloadXml(rawProfile: string): string {
  return buildPlist(installProfile({ rawProfile })).trim();
}

// --- RTS wifi profiles ---

export async function upsertRtsProfile(
  db: Database,
  fileStore: FileStore,
  input: { name?: string; file: UploadedFile },
): Promise<typeof schema.rtsWifiProfiles.$inferSelect> {
  assertPresent("name", input.name);
  const stored = await fileStore.upload(input.file);
  const data = formatStoredFileData(stored);
  const [existing] = await db
    .select()
    .from(schema.rtsWifiProfiles)
    .where(eq(schema.rtsWifiProfiles.name, input.name as string))
    .limit(1);
  if (existing) {
    const [row] = await db
      .update(schema.rtsWifiProfiles)
      .set({ assetFileData: data, updatedAt: new Date() })
      .where(eq(schema.rtsWifiProfiles.id, existing.id))
      .returning();
    return row;
  }
  const now = new Date();
  const [row] = await db
    .insert(schema.rtsWifiProfiles)
    .values({ name: input.name as string, assetFileData: data, createdAt: now, updatedAt: now })
    .returning();
  return row;
}

export async function deleteRtsProfile(
  db: Database,
  fileStore: FileStore,
  id: number,
): Promise<void> {
  const [row] = await db
    .select()
    .from(schema.rtsWifiProfiles)
    .where(eq(schema.rtsWifiProfiles.id, id))
    .limit(1);
  if (!row) {
    throw new RecordNotFound(`Couldn't find Rts::WifiProfile with id=${id}`);
  }
  await fileStore.deleteStored(parseStoredFileData(row.assetFileData));
  await db.delete(schema.rtsWifiProfiles).where(eq(schema.rtsWifiProfiles.id, id));
}

// --- VPP content tokens ---

export async function upsertVppToken(
  db: Database,
  filename: string,
  content: string,
): Promise<typeof schema.vppContentTokens.$inferSelect> {
  const parsed = parseVppToken(content);
  const now = new Date();
  const [existing] = await db
    .select()
    .from(schema.vppContentTokens)
    .where(eq(schema.vppContentTokens.filename, filename))
    .limit(1);
  if (existing) {
    const [row] = await db
      .update(schema.vppContentTokens)
      .set({ value: parsed.value, expDate: parsed.expDate, updatedAt: new Date() })
      .where(eq(schema.vppContentTokens.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(schema.vppContentTokens)
    .values({ filename, value: parsed.value, expDate: parsed.expDate, createdAt: now, updatedAt: now })
    .returning();
  return row;
}

export async function findVppTokenByFilename(
  db: Database,
  filename: string,
): Promise<typeof schema.vppContentTokens.$inferSelect> {
  const [row] = await db
    .select()
    .from(schema.vppContentTokens)
    .where(eq(schema.vppContentTokens.filename, filename))
    .limit(1);
  if (!row) {
    throw new RecordNotFound(`no VppContentToken with filename ${filename}`);
  }
  return row;
}

// --- DEP server tokens ---

export async function upsertDepToken(
  db: Database,
  filename: string,
  content: Uint8Array,
  depKeyPem: string,
): Promise<typeof schema.depServerTokens.$inferSelect> {
  const parsed = await decryptDepToken(content, depKeyPem);
  const [existing] = await db
    .select()
    .from(schema.depServerTokens)
    .where(eq(schema.depServerTokens.filename, filename))
    .limit(1);
  const values = {
    rawPayload: parsed.rawPayload,
    consumerKey: parsed.consumerKey,
    consumerSecret: parsed.consumerSecret,
    accessToken: parsed.accessToken,
    accessSecret: parsed.accessSecret,
    accessTokenExpiry: parsed.accessTokenExpiry,
  };
  if (existing) {
    const [row] = await db
      .update(schema.depServerTokens)
      .set(values)
      .where(eq(schema.depServerTokens.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(schema.depServerTokens)
    .values({ filename, ...values })
    .returning();
  return row;
}

export async function findDepTokenByFilename(
  db: Database,
  filename: string,
): Promise<typeof schema.depServerTokens.$inferSelect> {
  const [row] = await db
    .select()
    .from(schema.depServerTokens)
    .where(eq(schema.depServerTokens.filename, filename))
    .limit(1);
  if (!row) {
    throw new RecordNotFound(`no DepServerToken with filename ${filename}`);
  }
  return row;
}

/** Refresh the GetToken target row from the live DEP account (injectable client). */
export async function updateGetTokenTarget(
  db: Database,
  token: typeof schema.depServerTokens.$inferSelect,
  client?: { get(path: string): Promise<unknown> },
): Promise<void> {
  const dep = client ?? new DepClient(token);
  const account = (await dep.get("account")) as { serverUuid?: unknown };
  const serverUuid = account.serverUuid;
  if (typeof serverUuid !== "string" || serverUuid.length === 0) {
    throw new Error("DEP account returned no serverUuid");
  }
  await db.transaction(async (tx) => {
    // Only one DEP token can be the GetToken target at a time.
    await tx
      .delete(schema.getTokenTargets)
      .where(ne(schema.getTokenTargets.depServerTokenId, token.id));
    const [existing] = await tx
      .select()
      .from(schema.getTokenTargets)
      .where(eq(schema.getTokenTargets.depServerTokenId, token.id))
      .limit(1);
    if (existing) {
      await tx
        .update(schema.getTokenTargets)
        .set({ serverUuid, updatedAt: new Date() })
        .where(eq(schema.getTokenTargets.id, existing.id));
    } else {
      await tx.insert(schema.getTokenTargets).values({ depServerTokenId: token.id, serverUuid, createdAt: new Date(), updatedAt: new Date() });
    }
  });
}

// --- IPA files ---

export async function createIpa(
  db: Database,
  fileStore: FileStore,
  input: { bundleIdentifier?: string; filename: string; file: UploadedFile },
): Promise<typeof schema.ipaFiles.$inferSelect> {
  assertPresent("bundle_identifier", input.bundleIdentifier);
  const stored = await fileStore.upload(input.file);
  const [row] = await db
    .insert(schema.ipaFiles)
    .values({
      bundleIdentifier: input.bundleIdentifier ?? "",
      filename: input.filename,
      assetFileData: formatStoredFileData(stored),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return row;
}

export async function updateIpa(
  db: Database,
  fileStore: FileStore,
  id: number,
  input: { bundleIdentifier?: string; filename?: string; file?: UploadedFile },
): Promise<typeof schema.ipaFiles.$inferSelect> {
  const [row] = await db.select().from(schema.ipaFiles).where(eq(schema.ipaFiles.id, id)).limit(1);
  if (!row) {
    throw new RecordNotFound(`Couldn't find IpaFile with id=${id}`);
  }
  const patch: Partial<typeof schema.ipaFiles.$inferInsert> = { updatedAt: new Date() };
  if (input.bundleIdentifier !== undefined) {
    patch.bundleIdentifier = input.bundleIdentifier;
  }
  if (input.file && input.filename !== undefined) {
    const stored = await fileStore.upload(input.file);
    patch.filename = input.filename;
    patch.assetFileData = formatStoredFileData(stored);
  }
  const [updated] = await db
    .update(schema.ipaFiles)
    .set(patch)
    .where(eq(schema.ipaFiles.id, id))
    .returning();
  if (input.file) {
    // Shrine parity: replacing the file deletes the old blob.
    await fileStore.deleteStored(parseStoredFileData(row.assetFileData));
  }
  return updated;
}

export async function deleteIpa(db: Database, fileStore: FileStore, id: number): Promise<void> {
  const [row] = await db.select().from(schema.ipaFiles).where(eq(schema.ipaFiles.id, id)).limit(1);
  if (!row) {
    throw new RecordNotFound(`Couldn't find IpaFile with id=${id}`);
  }
  await fileStore.deleteStored(parseStoredFileData(row.assetFileData));
  await db.delete(schema.ipaFiles).where(eq(schema.ipaFiles.id, id));
}

export async function findIpasForInstall(
  db: Database,
  udids: string[],
): Promise<(typeof schema.mdmDevices.$inferSelect)[]> {
  if (udids.length === 0) {
    return [];
  }
  return db.select().from(schema.mdmDevices).where(inArray(schema.mdmDevices.udid, udids));
}

// --- DDM public-asset details (file uploads) ---

export async function upsertPublicAssetDetail(
  db: Database,
  fileStore: FileStore,
  masterId: number,
  input: { targetIdentifier?: string; file: UploadedFile },
): Promise<void> {
  const masterIdNum = parseIdParam(String(masterId));
  const [master] = await db
    .select()
    .from(schema.ddmPublicAssets)
    .where(eq(schema.ddmPublicAssets.id, masterIdNum))
    .limit(1);
  if (!master) {
    throw new RecordNotFound(`Couldn't find record with id=${masterIdNum}`);
  }
  const target =
    input.targetIdentifier && input.targetIdentifier !== "" ? input.targetIdentifier : null;
  const stored = await fileStore.upload(input.file);
  const data = formatStoredFileData(stored);
  const existing = await db
    .select()
    .from(schema.ddmPublicAssetDetails)
    .where(eq(schema.ddmPublicAssetDetails.ddmPublicAssetId, masterIdNum));
  const match = existing.find((row) => row.targetIdentifier === target);
  if (match) {
    await db
      .update(schema.ddmPublicAssetDetails)
      .set({ assetFileData: data })
      .where(eq(schema.ddmPublicAssetDetails.id, match.id));
  } else {
    await db.insert(schema.ddmPublicAssetDetails).values({
      ddmPublicAssetId: masterIdNum,
      targetIdentifier: target,
      assetFileData: data,
      createdAt: new Date(),
    });
  }
}

export async function deletePublicAssetDetail(
  db: Database,
  masterId: number,
  detailId: number,
): Promise<void> {
  const [detail] = await db
    .select()
    .from(schema.ddmPublicAssetDetails)
    .where(eq(schema.ddmPublicAssetDetails.id, detailId))
    .limit(1);
  if (!detail || detail.ddmPublicAssetId !== masterId) {
    throw new RecordNotFound(`Couldn't find record with id=${detailId}`);
  }
  await db
    .delete(schema.ddmPublicAssetDetails)
    .where(eq(schema.ddmPublicAssetDetails.id, detailId));
}

/** Delete a public asset with every detail blob (destroy_with_blobs!). */
export async function deletePublicAssetWithBlobs(
  db: Database,
  fileStore: FileStore,
  id: number,
): Promise<void> {
  const [master] = await db
    .select()
    .from(schema.ddmPublicAssets)
    .where(eq(schema.ddmPublicAssets.id, id))
    .limit(1);
  if (!master) {
    throw new RecordNotFound(`Couldn't find record with id=${id}`);
  }
  const details = await db
    .select()
    .from(schema.ddmPublicAssetDetails)
    .where(eq(schema.ddmPublicAssetDetails.ddmPublicAssetId, id));
  for (const detail of details) {
    await fileStore.deleteStored(parseStoredFileData(detail.assetFileData));
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.ddmPublicAssetDetails)
      .where(eq(schema.ddmPublicAssetDetails.ddmPublicAssetId, id));
    await tx.delete(schema.ddmPublicAssets).where(eq(schema.ddmPublicAssets.id, id));
  });
}

// --- Admin list queries ---

export async function listMdmDevices(db: Database) {
  return db.select().from(schema.mdmDevices).orderBy(asc(schema.mdmDevices.id));
}

export async function listByodDevices(db: Database) {
  return db.select().from(schema.byodDevices).orderBy(asc(schema.byodDevices.id));
}

export async function listRtsProfiles(db: Database) {
  return db.select().from(schema.rtsWifiProfiles).orderBy(asc(schema.rtsWifiProfiles.id));
}

export async function listVppTokens(db: Database) {
  return db.select().from(schema.vppContentTokens).orderBy(asc(schema.vppContentTokens.id));
}

export async function listIpaFiles(db: Database) {
  return db.select().from(schema.ipaFiles).orderBy(asc(schema.ipaFiles.id));
}

export async function listDepTokens(db: Database) {
  return db.select().from(schema.depServerTokens).orderBy(asc(schema.depServerTokens.id));
}

/** Queue rows for one device identifier (udid or enrollment id). */
export async function queueForIdentifier(db: Database, deviceIdentifier: string) {
  const requests = await db
    .select()
    .from(schema.mdmCommandRequests)
    .where(eq(schema.mdmCommandRequests.deviceIdentifier, deviceIdentifier))
    .orderBy(asc(schema.mdmCommandRequests.id));
  const handling = await db
    .select()
    .from(schema.mdmCommandHandlingRequests)
    .where(eq(schema.mdmCommandHandlingRequests.deviceIdentifier, deviceIdentifier))
    .orderBy(asc(schema.mdmCommandHandlingRequests.id));
  const histories = await db
    .select()
    .from(schema.mdmCommandHistories)
    .where(eq(schema.mdmCommandHistories.deviceIdentifier, deviceIdentifier))
    .orderBy(asc(schema.mdmCommandHistories.id));
  return { requests, handling, histories };
}

export async function syncHistoriesForDevice(db: Database, udid: string, limit = 100) {
  return db
    .select({
      id: schema.ddmSynchronizationRequestHistories.id,
      endpoint: schema.ddmSynchronizationRequestHistories.endpoint,
      createdAt: schema.ddmSynchronizationRequestHistories.createdAt,
    })
    .from(schema.ddmSynchronizationRequestHistories)
    .where(eq(schema.ddmSynchronizationRequestHistories.deviceIdentifier, udid))
    .orderBy(desc(schema.ddmSynchronizationRequestHistories.id))
    .limit(limit);
}

export async function findSyncHistory(db: Database, udid: string, id: number) {
  const [row] = await db
    .select()
    .from(schema.ddmSynchronizationRequestHistories)
    .where(
      and(
        eq(schema.ddmSynchronizationRequestHistories.deviceIdentifier, udid),
        eq(schema.ddmSynchronizationRequestHistories.id, id),
      ),
    )
    .limit(1);
  if (!row) {
    throw new RecordNotFound(`no SynchronizationRequestHistory with id ${id} for ${udid}`);
  }
  return row;
}

/** Access-token row attributes for a BYOD enrollment (or `{}` when none). */
export async function byodAccessTokenAttributes(
  db: Database,
  enrollmentId: string,
): Promise<Record<string, unknown>> {
  const [usage] = await db
    .select()
    .from(schema.managedAppleAccountAccessTokenUsages)
    .where(eq(schema.managedAppleAccountAccessTokenUsages.deviceIdentifier, enrollmentId))
    .limit(1);
  if (!usage) {
    return {};
  }
  const [token] = await db
    .select()
    .from(schema.managedAppleAccountAccessTokens)
    .where(eq(schema.managedAppleAccountAccessTokens.id, usage.managedAppleAccountAccessTokenId))
    .limit(1);
  if (!token) {
    return {};
  }
  return {
    id: token.id,
    managed_apple_account_id: token.managedAppleAccountId,
    token: token.token,
    created_at: token.createdAt.toISOString(),
    expires_at: token.expiresAt.toISOString(),
    updated_at: token.updatedAt.toISOString(),
  };
}

export async function pushEndpointsForUdids(
  db: Database,
  udids: string[],
): Promise<Map<string, { token: string; pushMagic: string }>> {
  const endpoints = new Map<string, { token: string; pushMagic: string }>();
  if (udids.length === 0) {
    return endpoints;
  }
  const devices = await db.select().from(schema.mdmDevices).where(inArray(schema.mdmDevices.udid, udids));
  for (const device of devices) {
    const [endpoint] = await db
      .select()
      .from(schema.mdmPushEndpoints)
      .where(eq(schema.mdmPushEndpoints.mdmDeviceId, device.id))
      .limit(1);
    if (endpoint) {
      endpoints.set(device.udid, { token: endpoint.token, pushMagic: endpoint.pushMagic });
    }
  }
  return endpoints;
}

export async function ipasOrderedByFilename(db: Database) {
  return db.select().from(schema.ipaFiles).orderBy(asc(schema.ipaFiles.filename));
}

export async function rtsProfilesOrderedByName(db: Database) {
  return db.select().from(schema.rtsWifiProfiles).orderBy(asc(schema.rtsWifiProfiles.name));
}

export async function findRtsProfileById(db: Database, id: number) {
  const [row] = await db
    .select()
    .from(schema.rtsWifiProfiles)
    .where(eq(schema.rtsWifiProfiles.id, id))
    .limit(1);
  if (!row) {
    throw new RecordNotFound(`Couldn't find Rts::WifiProfile with id=${id}`);
  }
  return row;
}

export async function findIpaById(db: Database, id: number) {
  const [row] = await db.select().from(schema.ipaFiles).where(eq(schema.ipaFiles.id, id)).limit(1);
  if (!row) {
    throw new RecordNotFound(`Couldn't find IpaFile with id=${id}`);
  }
  return row;
}

export async function mdmDevicesOrderedBySerial(db: Database) {
  return db.select().from(schema.mdmDevices).orderBy(asc(schema.mdmDevices.serialNumber));
}

export async function findCommandHistoryByUuid(
  db: Database,
  commandUuid: string,
): Promise<typeof schema.mdmCommandHistories.$inferSelect> {
  const [row] = await db
    .select()
    .from(schema.mdmCommandHistories)
    .where(eq(schema.mdmCommandHistories.commandUuid, commandUuid))
    .limit(1);
  if (!row) {
    throw new RecordNotFound(`no MdmCommandHistory with command_uuid ${commandUuid}`);
  }
  return row;
}
