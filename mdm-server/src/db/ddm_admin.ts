import { and, asc, eq, isNull, notInArray } from "drizzle-orm";
import { parse as parseYaml } from "yaml";
import type { Database as Db } from "../db";
import * as schema from "../schema";
import { RecordNotFound } from "./accounts";

/** Thrown when a value fails a presence check (Ruby `validates ... presence`). */
export class ValidationError extends Error {}

export { RecordNotFound };

/** Ruby `blank?` for JSON/YAML values. */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined || value === false) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim() === "";
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length === 0;
  }
  return false;
}

export function assertPresent(field: string, value: unknown): void {
  if (isBlank(value)) {
    throw new ValidationError(`${field} can't be blank`);
  }
}

export function parseIdParam(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id)) {
    throw new RecordNotFound(`Couldn't find record with id=${value}`);
  }
  return id;
}

export function parsePayloadYaml(text: string | undefined): unknown {
  if (text === undefined) {
    throw new ValidationError("payload can't be blank");
  }
  const parsed: unknown = parseYaml(text);
  assertPresent("payload", parsed);
  return parsed;
}

/** Split a serial-number textarea into non-blank, stripped lines. */
export function parseSerialNumbers(text: string | undefined): string[] {
  if (!text) {
    return [];
  }
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

async function findOrThrow<T>(
  table: "ddmActivations" | "ddmConfigurations" | "ddmAssets" | "ddmManagements" | "ddmPublicAssets" | "ddmDeviceGroups",
  id: number,
  db: Db,
): Promise<T> {
  const rows = await db.select().from((schema as any)[table]).where(eq((schema as any)[table].id, id));
  if (rows.length === 0) {
    throw new RecordNotFound(`Couldn't find record with id=${id}`);
  }
  return rows[0] as T;
}

// --- Activations (ActivationForm: name + YAML payload + target checkboxes) ---

export async function createActivation(
  db: Db,
  input: { name?: string; payloadYaml?: string; targetIdentifiers?: string[] },
): Promise<typeof schema.ddmActivations.$inferSelect> {
  assertPresent("name", input.name);
  const payload = parsePayloadYaml(input.payloadYaml);
  const [activation] = await db
    .insert(schema.ddmActivations)
    .values({ name: input.name as string, type: "standard", payload: JSON.stringify(payload), createdAt: new Date(), updatedAt: new Date() })
    .returning();
  const targets = (input.targetIdentifiers ?? []).filter((t) => t !== "");
  if (targets.length > 0) {
    await db.insert(schema.ddmActivationTargets).values(
      targets.map((identifier) => ({
        ddmActivationId: activation.id,
        targetIdentifier: identifier,
        createdAt: new Date(),
      })),
    );
  }
  return activation;
}

/** NOTE: `name` is ignored on update (Ruby form slices only payload/targets). */
export async function updateActivation(
  db: Db,
  id: number,
  input: { payloadYaml?: string; targetIdentifiers?: string[] },
): Promise<typeof schema.ddmActivations.$inferSelect> {
  const activation = await findOrThrow<typeof schema.ddmActivations.$inferSelect>(
    "ddmActivations",
    id,
    db,
  );
  const payload = parsePayloadYaml(input.payloadYaml);
  const desired = (input.targetIdentifiers ?? []).filter((t) => t !== "");
  await db.transaction(async (tx) => {
    await tx
      .update(schema.ddmActivations)
      .set({ type: "standard", payload: JSON.stringify(payload) })
      .where(eq(schema.ddmActivations.id, id));
    const existing = await tx
      .select()
      .from(schema.ddmActivationTargets)
      .where(eq(schema.ddmActivationTargets.ddmActivationId, id));
    for (const row of existing) {
      if (row.targetIdentifier === null || !desired.includes(row.targetIdentifier)) {
        await tx.delete(schema.ddmActivationTargets).where(eq(schema.ddmActivationTargets.id, row.id));
      }
    }
    const current = existing
      .map((row) => row.targetIdentifier)
      .filter((identifier): identifier is string => identifier !== null)
      .filter((identifier) => desired.includes(identifier));
    for (const identifier of desired) {
      if (!current.includes(identifier)) {
        await tx.insert(schema.ddmActivationTargets).values({
          ddmActivationId: id,
          targetIdentifier: identifier,
          createdAt: new Date(),
        });
      }
    }
  });
  return { ...activation, type: "standard", payload: JSON.stringify(payload) };
}

export async function deleteActivation(db: Db, id: number): Promise<void> {
  await findOrThrow("ddmActivations", id, db);
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.ddmActivationTargets)
      .where(eq(schema.ddmActivationTargets.ddmActivationId, id));
    await tx.delete(schema.ddmActivations).where(eq(schema.ddmActivations.id, id));
  });
}

export interface ActivationWithTargets {
  activation: typeof schema.ddmActivations.$inferSelect;
  targets: (typeof schema.ddmActivationTargets.$inferSelect)[];
}

export async function listActivationsWithTargets(db: Db): Promise<ActivationWithTargets[]> {
  const activations = await db.select().from(schema.ddmActivations).orderBy(asc(schema.ddmActivations.id));
  const out: ActivationWithTargets[] = [];
  for (const activation of activations) {
    const targets = await db
      .select()
      .from(schema.ddmActivationTargets)
      .where(eq(schema.ddmActivationTargets.ddmActivationId, activation.id))
      .orderBy(asc(schema.ddmActivationTargets.id));
    out.push({ activation, targets });
  }
  return out;
}

export async function getActivationWithTargets(
  db: Db,
  id: number,
): Promise<ActivationWithTargets> {
  const activation = await findOrThrow<typeof schema.ddmActivations.$inferSelect>(
    "ddmActivations",
    id,
    db,
  );
  const targets = await db
    .select()
    .from(schema.ddmActivationTargets)
    .where(eq(schema.ddmActivationTargets.ddmActivationId, id))
    .orderBy(asc(schema.ddmActivationTargets.id));
  return { activation, targets };
}

/**
 * Targets ordered like `ActivationTarget.display_sorted`: NULL first, then
 * group name / group items interleaved per group, then leftover identifiers.
 */
export async function listActivationTargetsDisplaySorted(
  db: Db,
): Promise<
  { target: typeof schema.ddmActivationTargets.$inferSelect; activation: typeof schema.ddmActivations.$inferSelect }[]
> {
  const groups = await db.select().from(schema.ddmDeviceGroups).orderBy(asc(schema.ddmDeviceGroups.id));
  const sortMap: (string | null)[] = [null];
  for (const group of groups) {
    sortMap.push(group.name);
    const items = await db
      .select()
      .from(schema.ddmDeviceGroupItems)
      .where(eq(schema.ddmDeviceGroupItems.ddmDeviceGroupId, group.id))
      .orderBy(asc(schema.ddmDeviceGroupItems.id));
    for (const item of items) {
      sortMap.push(item.deviceIdentifier);
    }
  }
  const activations = await db.select().from(schema.ddmActivations).orderBy(asc(schema.ddmActivations.id));
  const byId = new Map(activations.map((a) => [a.id, a]));
  const targets = await db
    .select()
    .from(schema.ddmActivationTargets)
    .orderBy(asc(schema.ddmActivationTargets.id));
  const grouped = new Map<string | null, typeof targets>();
  for (const target of targets) {
    const list = grouped.get(target.targetIdentifier) ?? [];
    list.push(target);
    grouped.set(target.targetIdentifier, list);
  }
  const out: {
    target: typeof schema.ddmActivationTargets.$inferSelect;
    activation: typeof schema.ddmActivations.$inferSelect;
  }[] = [];
  for (const identifier of sortMap) {
    for (const target of grouped.get(identifier) ?? []) {
      out.push({ target, activation: byId.get(target.ddmActivationId)! });
    }
  }
  for (const target of targets) {
    if (target.targetIdentifier !== null && !sortMap.includes(target.targetIdentifier)) {
      out.push({ target, activation: byId.get(target.ddmActivationId)! });
    }
  }
  return out;
}

// --- Configurations (update touches type+payload only; name is ignored) ---

export async function createConfiguration(
  db: Db,
  input: { name?: string; type?: string; payloadYaml?: string },
): Promise<typeof schema.ddmConfigurations.$inferSelect> {
  assertPresent("name", input.name);
  assertPresent("type", input.type);
  const payload = parsePayloadYaml(input.payloadYaml);
  const [row] = await db
    .insert(schema.ddmConfigurations)
    .values({ name: input.name as string, type: input.type as string, payload: JSON.stringify(payload), createdAt: new Date(), updatedAt: new Date() })
    .returning();
  return row;
}

export async function updateConfiguration(
  db: Db,
  id: number,
  input: { type?: string; payloadYaml?: string },
): Promise<typeof schema.ddmConfigurations.$inferSelect> {
  await findOrThrow("ddmConfigurations", id, db);
  assertPresent("type", input.type);
  const payload = parsePayloadYaml(input.payloadYaml);
  const [row] = await db
    .update(schema.ddmConfigurations)
    .set({ type: input.type as string, payload: JSON.stringify(payload) })
    .where(eq(schema.ddmConfigurations.id, id))
    .returning();
  return row;
}

export async function deleteConfiguration(db: Db, id: number): Promise<void> {
  await findOrThrow("ddmConfigurations", id, db);
  await db.delete(schema.ddmConfigurations).where(eq(schema.ddmConfigurations.id, id));
}

// --- Assets / Managements / PublicAssets (master + per-target details) ---

type DetailTable = "ddmAssetDetails" | "ddmManagementDetails" | "ddmPublicAssetDetails";
type MasterTable = "ddmAssets" | "ddmManagements" | "ddmPublicAssets";

function detailConfig(kind: "asset" | "management" | "publicAsset"): {
  master: MasterTable;
  detail: DetailTable;
  foreignKey: "ddmAssetId" | "ddmManagementId" | "ddmPublicAssetId";
} {
  if (kind === "asset") {
    return { master: "ddmAssets", detail: "ddmAssetDetails", foreignKey: "ddmAssetId" };
  }
  if (kind === "management") {
    return { master: "ddmManagements", detail: "ddmManagementDetails", foreignKey: "ddmManagementId" };
  }
  return { master: "ddmPublicAssets", detail: "ddmPublicAssetDetails", foreignKey: "ddmPublicAssetId" };
}

export async function createMaster(
  db: Db,
  kind: "asset" | "management" | "publicAsset",
  input: { name?: string; type?: string },
): Promise<{ id: number; name: string; type: string }> {
  assertPresent("name", input.name);
  const cfg = detailConfig(kind);
  const [row] = await db
    .insert((schema as any)[cfg.master])
    .values(
      kind === "publicAsset"
        ? { name: input.name as string, createdAt: new Date(), updatedAt: new Date() }
        : { name: input.name as string, type: input.type as string, createdAt: new Date() },
    )
    .returning();
  return row;
}

export async function deleteMaster(
  db: Db,
  kind: "asset" | "management",
  id: number,
): Promise<void> {
  const cfg = detailConfig(kind);
  await findOrThrow(cfg.master, id, db);
  await db.transaction(async (tx) => {
    await tx
      .delete((schema as any)[cfg.detail])
      .where(eq((schema as any)[cfg.detail][cfg.foreignKey], id));
    await tx.delete((schema as any)[cfg.master]).where(eq((schema as any)[cfg.master].id, id));
  });
}

/** Upsert by target_identifier (NULL when the form field is blank). */
export async function upsertDetailPayload(
  db: Db,
  kind: "asset" | "management",
  masterId: number,
  input: { targetIdentifier?: string; payloadYaml?: string },
): Promise<void> {
  const cfg = detailConfig(kind);
  await findOrThrow(cfg.master, masterId, db);
  const payload = parsePayloadYaml(input.payloadYaml);
  const target = input.targetIdentifier && input.targetIdentifier !== "" ? input.targetIdentifier : null;
  const existing = await db
    .select()
    .from((schema as any)[cfg.detail])
    .where(
      and(
        eq((schema as any)[cfg.detail][cfg.foreignKey], masterId),
        target === null
          ? isNull((schema as any)[cfg.detail].targetIdentifier)
          : eq((schema as any)[cfg.detail].targetIdentifier, target),
      ),
    )
    .orderBy(asc((schema as any)[cfg.detail].id))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update((schema as any)[cfg.detail])
      .set({ payload: JSON.stringify(payload) })
      .where(eq((schema as any)[cfg.detail].id, existing[0].id));
  } else {
    await db.insert((schema as any)[cfg.detail]).values({
      [cfg.foreignKey]: masterId,
      targetIdentifier: target,
      payload: JSON.stringify(payload),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

export interface MasterWithDetails<TMaster, TDetail> {
  master: TMaster;
  details: TDetail[];
}

/**
 * Masters with details in `DetailsPrioritySorted` order: group-member
 * identifiers first, then group names, then the NULL fallback. Details whose
 * target matches nothing are dropped, exactly like the Ruby version.
 */
export async function listMastersPrioritySorted(
  db: Db,
  kind: "asset" | "management" | "publicAsset",
  onlyId?: number,
): Promise<MasterWithDetails<{ id: number; name: string; type?: string }, { id: number } & Record<string, unknown>>[]> {
  const cfg = detailConfig(kind);
  const groups = await db.select().from(schema.ddmDeviceGroups).orderBy(asc(schema.ddmDeviceGroups.id));
  const sortMap: (string | null)[] = [];
  const visited = new Set<string>();
  const groupNames: string[] = [];
  for (const group of groups) {
    groupNames.push(group.name);
    const items = await db
      .select()
      .from(schema.ddmDeviceGroupItems)
      .where(eq(schema.ddmDeviceGroupItems.ddmDeviceGroupId, group.id))
      .orderBy(asc(schema.ddmDeviceGroupItems.id));
    for (const item of items) {
      if (!visited.has(item.deviceIdentifier)) {
        visited.add(item.deviceIdentifier);
        sortMap.push(item.deviceIdentifier);
      }
    }
  }
  sortMap.push(...groupNames, null);

  const masters = (
    onlyId === undefined
      ? await db.select().from((schema as any)[cfg.master]).orderBy(asc((schema as any)[cfg.master].id))
      : await db.select().from((schema as any)[cfg.master]).where(eq((schema as any)[cfg.master].id, onlyId))
  ) as { id: number; name: string; type?: string }[];
  const out: MasterWithDetails<
    { id: number; name: string; type?: string },
    { id: number } & Record<string, unknown>
  >[] = [];
  for (const master of masters) {
    const details = (await db
      .select()
      .from((schema as any)[cfg.detail])
      .where(eq((schema as any)[cfg.detail][cfg.foreignKey], master.id))) as ({
      id: number;
      targetIdentifier: string | null;
    } & Record<string, unknown>)[];
    const indexed = new Map<string | null, (typeof details)[number]>();
    for (const detail of details) {
      indexed.set(detail.targetIdentifier, detail);
    }
    out.push({
      master,
      details: sortMap
        .map((identifier) => indexed.get(identifier))
        .filter((detail) => detail !== undefined),
    });
  }
  return out;
}

// --- Device groups ---

export async function createDeviceGroup(
  db: Db,
  input: { name?: string; serialNumbersText?: string },
): Promise<typeof schema.ddmDeviceGroups.$inferSelect> {
  assertPresent("name", input.name);
  const serialNumbers = parseSerialNumbers(input.serialNumbersText);
  if (serialNumbers.length === 0) {
    const now = new Date();
    const [group] = await db
      .insert(schema.ddmDeviceGroups)
      .values({ name: input.name as string, createdAt: now, updatedAt: now })
      .returning();
    return group;
  }
  return db.transaction(async (tx) => {
    const txNow = new Date();
    const [group] = await tx
      .insert(schema.ddmDeviceGroups)
      .values({ name: input.name as string, createdAt: txNow, updatedAt: txNow })
      .returning();
    await tx.insert(schema.ddmDeviceGroupItems).values(
      serialNumbers.map((serial) => ({
        ddmDeviceGroupId: group.id,
        deviceIdentifier: serial,
        createdAt: txNow,
      })),
    );
    return group;
  });
}

/**
 * Item sync with the Ruby quirk preserved: deletions only happen together
 * with additions (or when the submitted list is empty, which clears all).
 */
export async function updateDeviceGroupItems(
  db: Db,
  id: number,
  serialNumbersText: string | undefined,
): Promise<void> {
  await findOrThrow("ddmDeviceGroups", id, db);
  const serialNumbers = parseSerialNumbers(serialNumbersText);
  if (serialNumbers.length === 0) {
    await db
      .delete(schema.ddmDeviceGroupItems)
      .where(eq(schema.ddmDeviceGroupItems.ddmDeviceGroupId, id));
    return;
  }
  const existing = await db
    .select()
    .from(schema.ddmDeviceGroupItems)
    .where(eq(schema.ddmDeviceGroupItems.ddmDeviceGroupId, id));
  const additions = serialNumbers.filter(
    (serial) => !existing.some((row) => row.deviceIdentifier === serial),
  );
  if (additions.length === 0) {
    return;
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.ddmDeviceGroupItems)
      .where(
        and(
          eq(schema.ddmDeviceGroupItems.ddmDeviceGroupId, id),
          notInArray(schema.ddmDeviceGroupItems.deviceIdentifier, serialNumbers),
        ),
      );
    await tx.insert(schema.ddmDeviceGroupItems).values(
      additions.map((serial) => ({
        ddmDeviceGroupId: id,
        deviceIdentifier: serial,
        createdAt: new Date(),
      })),
    );
  });
}

export async function renameDeviceGroup(
  db: Db,
  id: number,
  name: string | undefined,
): Promise<void> {
  await findOrThrow("ddmDeviceGroups", id, db);
  assertPresent("name", name);
  await db
    .update(schema.ddmDeviceGroups)
    .set({ name: name as string })
    .where(eq(schema.ddmDeviceGroups.id, id));
}

/** Activation target checkbox options: group names, then device serials. */
export async function targetOptions(db: Db): Promise<string[]> {
  const groups = await db.select().from(schema.ddmDeviceGroups).orderBy(asc(schema.ddmDeviceGroups.name));
  const devices = await db.select().from(schema.mdmDevices).orderBy(asc(schema.mdmDevices.serialNumber));
  return [...groups.map((g) => g.name), ...devices.map((d) => d.serialNumber)];
}
