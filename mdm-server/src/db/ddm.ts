import { asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { Database } from "../db";
import {
  ddmActivationTargets,
  ddmActivations,
  ddmAssetDetails,
  ddmAssets,
  ddmConfigurations,
  ddmDeviceGroupItems,
  ddmDeviceGroups,
  ddmManagementDetails,
  ddmManagements,
  ddmPublicAssetDetails,
  ddmPublicAssets,
  ddmSynchronizationRequestHistories,
} from "../schema";
import type {
  ActivationRow,
  AssetDetailRow,
  AssetRow,
  ConfigurationRow,
  DeclarationInput,
  ManagementDetailRow,
  PublicAssetDetailRow,
} from "../ddm/declaration";
import type { JsonValue } from "../ddm/identifiers";

/**
 * DDM query layer (ported from the `Ddm::*` scopes): per-device targeting
 * with serial > groups > fallback priority.
 */
export async function groupsIncluding(db: Database, identifier: string): Promise<string[]> {
  const items = await db
    .select({ groupId: ddmDeviceGroupItems.ddmDeviceGroupId })
    .from(ddmDeviceGroupItems)
    .where(eq(ddmDeviceGroupItems.deviceIdentifier, identifier));
  if (items.length === 0) {
    return [];
  }
  const groups = await db
    .select({ name: ddmDeviceGroups.name })
    .from(ddmDeviceGroups)
    .where(
      inArray(
        ddmDeviceGroups.id,
        items.map((item) => item.groupId),
      ),
    );
  return groups.map((group) => group.name);
}

interface DetailCandidate {
  id: number;
  masterId: number;
  targetIdentifier: string | null;
}

/**
 * One winning detail per master. Priority (smaller wins): device serial -1,
 * alphabetically sorted groups 0.., fallback nil last. On ties (multiple nil
 * rows, which the unique index permits) the lowest id wins deterministically.
 */
function pickWinners<T extends DetailCandidate>(
  rows: T[],
  identifier: string,
  groupNames: string[],
): T[] {
  const priorities = new Map<string | null, number>();
  priorities.set(null, groupNames.length);
  priorities.set(identifier, -1);
  for (const [index, name] of groupNames.entries()) {
    priorities.set(name, index);
  }
  const winners = new Map<number, T>();
  const ordered = [...rows].sort((a, b) => a.id - b.id);
  for (const row of ordered) {
    const priority = priorities.get(row.targetIdentifier);
    if (priority === undefined) {
      continue;
    }
    const existing = winners.get(row.masterId);
    if (!existing || priority < priorities.get(existing.targetIdentifier)!) {
      winners.set(row.masterId, row);
    }
  }
  return [...winners.values()].sort((a, b) => a.id - b.id);
}

function parsePayload(text: string): JsonValue {
  return JSON.parse(text) as JsonValue;
}

export async function activationsFor(db: Database, identifier: string): Promise<ActivationRow[]> {
  const groups = await groupsIncluding(db, identifier);
  const candidates = [...groups, identifier];
  const targets = await db
    .select()
    .from(ddmActivationTargets)
    .where(
      or(inArray(ddmActivationTargets.targetIdentifier, candidates), isNull(ddmActivationTargets.targetIdentifier)),
    );
  const ids = [...new Set(targets.map((target) => target.ddmActivationId))];
  if (ids.length === 0) {
    return [];
  }
  const rows = await db
    .select()
    .from(ddmActivations)
    .where(inArray(ddmActivations.id, ids))
    .orderBy(asc(ddmActivations.id));
  return rows.map((row) => ({ name: row.name, type: row.type, payload: parsePayload(row.payload) }));
}

export async function allConfigurations(db: Database): Promise<ConfigurationRow[]> {
  const rows = await db.select().from(ddmConfigurations).orderBy(asc(ddmConfigurations.id));
  return rows.map((row) => ({ name: row.name, type: row.type, payload: parsePayload(row.payload) }));
}

export async function allAssets(db: Database): Promise<AssetRow[]> {
  const rows = await db.select().from(ddmAssets).orderBy(asc(ddmAssets.id));
  return rows.map((row) => ({ name: row.name }));
}

export async function assetDetailsFor(db: Database, identifier: string): Promise<AssetDetailRow[]> {
  const groups = (await groupsIncluding(db, identifier)).sort();
  const candidates = [...groups, identifier];
  const rows = await db
    .select({
      id: ddmAssetDetails.id,
      masterId: ddmAssetDetails.ddmAssetId,
      targetIdentifier: ddmAssetDetails.targetIdentifier,
      payload: ddmAssetDetails.payload,
      assetName: ddmAssets.name,
      assetType: ddmAssets.type,
    })
    .from(ddmAssetDetails)
    .innerJoin(ddmAssets, eq(ddmAssetDetails.ddmAssetId, ddmAssets.id))
    .where(
      or(inArray(ddmAssetDetails.targetIdentifier, candidates), isNull(ddmAssetDetails.targetIdentifier)),
    );
  return pickWinners(rows, identifier, groups).map((row) => ({
    assetName: row.assetName,
    assetType: row.assetType,
    payload: parsePayload(row.payload),
  }));
}

export async function managementDetailsFor(
  db: Database,
  identifier: string,
): Promise<ManagementDetailRow[]> {
  const groups = (await groupsIncluding(db, identifier)).sort();
  const candidates = [...groups, identifier];
  const rows = await db
    .select({
      id: ddmManagementDetails.id,
      masterId: ddmManagementDetails.ddmManagementId,
      targetIdentifier: ddmManagementDetails.targetIdentifier,
      payload: ddmManagementDetails.payload,
      managementName: ddmManagements.name,
      managementType: ddmManagements.type,
    })
    .from(ddmManagementDetails)
    .innerJoin(ddmManagements, eq(ddmManagementDetails.ddmManagementId, ddmManagements.id))
    .where(
      or(
        inArray(ddmManagementDetails.targetIdentifier, candidates),
        isNull(ddmManagementDetails.targetIdentifier),
      ),
    );
  return pickWinners(rows, identifier, groups).map((row) => ({
    managementName: row.managementName,
    managementType: row.managementType,
    payload: parsePayload(row.payload),
  }));
}

export interface PublicAssetDetailCandidate {
  assetName: string;
  assetFileData: string;
}

export async function publicAssetDetailsFor(
  db: Database,
  identifier: string,
): Promise<PublicAssetDetailCandidate[]> {
  const groups = (await groupsIncluding(db, identifier)).sort();
  const candidates = [...groups, identifier];
  const rows = await db
    .select({
      id: ddmPublicAssetDetails.id,
      masterId: ddmPublicAssetDetails.ddmPublicAssetId,
      targetIdentifier: ddmPublicAssetDetails.targetIdentifier,
      assetFileData: ddmPublicAssetDetails.assetFileData,
      assetName: ddmPublicAssets.name,
    })
    .from(ddmPublicAssetDetails)
    .innerJoin(ddmPublicAssets, eq(ddmPublicAssetDetails.ddmPublicAssetId, ddmPublicAssets.id))
    .where(
      or(
        inArray(ddmPublicAssetDetails.targetIdentifier, candidates),
        isNull(ddmPublicAssetDetails.targetIdentifier),
      ),
    );
  return pickWinners(rows, identifier, groups).map((row) => ({
    assetName: row.assetName,
    assetFileData: row.assetFileData,
  }));
}

/** Assemble everything `Declaration` needs for one device. */
export async function declarationInputFor(
  db: Database,
  identifier: string,
  publicAssetUrl: (assetName: string, assetFileData: string) => string,
): Promise<DeclarationInput> {
  const [activations, configurations, assets, assetDetails, managementDetails, publicDetails] =
    await Promise.all([
      activationsFor(db, identifier),
      allConfigurations(db),
      allAssets(db),
      assetDetailsFor(db, identifier),
      managementDetailsFor(db, identifier),
      publicAssetDetailsFor(db, identifier),
    ]);
  const publicAssetDetails: PublicAssetDetailRow[] = publicDetails.map((detail) => ({
    assetName: detail.assetName,
    accessUrl: publicAssetUrl(detail.assetName, detail.assetFileData),
  }));
  return { activations, configurations, assets, assetDetails, managementDetails, publicAssetDetails };
}

export async function logSyncResponse(
  db: Database,
  deviceIdentifier: string,
  endpoint: string,
  data: unknown,
  response: unknown,
): Promise<void> {
  await db.insert(ddmSynchronizationRequestHistories).values({
    deviceIdentifier,
    endpoint,
    requestPayload: data === null || data === undefined ? null : JSON.stringify(data),
    responsePayload: JSON.stringify(response),
    createdAt: new Date(),
  });
}

export async function logSync404(
  db: Database,
  deviceIdentifier: string,
  endpoint: string,
  data: unknown,
): Promise<void> {
  await db.insert(ddmSynchronizationRequestHistories).values({
    deviceIdentifier,
    endpoint,
    requestPayload: data === null || data === undefined ? null : JSON.stringify(data),
    responsePayload: null,
    createdAt: new Date(),
  });
}
