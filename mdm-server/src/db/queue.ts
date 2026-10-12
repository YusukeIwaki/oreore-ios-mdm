import { and, asc, count, eq } from "drizzle-orm";
import { buildPlist, parsePlist } from "../mdm/plist";
import type { Database } from "../db";
import {
  mdmCommandHandlingRequests,
  mdmCommandHistories,
  mdmCommandRequests,
} from "../schema";

/**
 * Per-device MDM command queue (ported from `CommandQueue`).
 * `request_payload` columns hold plist XML, like the Ruby `:plist` type.
 */
export interface HandlingRequest {
  id: number;
  deviceIdentifier: string;
  commandUuid: string;
  requestPayloadXml: string;
}

export class HandlingRequestNotFound extends Error {
  constructor(deviceIdentifier: string, commandUuid: string) {
    super(
      `no handling request for device ${deviceIdentifier} command ${commandUuid}`,
    );
    this.name = "HandlingRequestNotFound";
  }
}

export async function enqueueCommand(
  db: Database,
  deviceIdentifier: string,
  requestPayload: unknown,
): Promise<void> {
  await db.insert(mdmCommandRequests).values({
    deviceIdentifier,
    requestPayload: buildPlist(requestPayload),
    createdAt: new Date(),
  });
}

/** Cartesian product of devices × payloads in a single INSERT. */
export async function bulkEnqueueCommands(
  db: Database,
  deviceIdentifiers: string[],
  payloads: unknown[],
): Promise<void> {
  const now = new Date();
  const rows = deviceIdentifiers.flatMap((deviceIdentifier) =>
    payloads.map((payload) => ({
      deviceIdentifier,
      requestPayload: buildPlist(payload),
      createdAt: now,
    })),
  );
  if (rows.length === 0) {
    return;
  }
  await db.insert(mdmCommandRequests).values(rows);
}

/** Atomically move the oldest pending request to "handling". */
export async function dequeueCommand(
  db: Database,
  deviceIdentifier: string,
): Promise<Record<string, unknown> | null> {
  const [first] = await db
    .select()
    .from(mdmCommandRequests)
    .where(eq(mdmCommandRequests.deviceIdentifier, deviceIdentifier))
    .orderBy(asc(mdmCommandRequests.id))
    .limit(1);
  if (!first) {
    return null;
  }
  const payload = parsePlist(first.requestPayload) as Record<string, unknown>;
  await db.transaction(async (tx) => {
    await tx.insert(mdmCommandHandlingRequests).values({
      deviceIdentifier: first.deviceIdentifier,
      commandUuid: payload.CommandUUID as string,
      requestPayload: first.requestPayload,
      createdAt: new Date(),
    });
    await tx.delete(mdmCommandRequests).where(eq(mdmCommandRequests.id, first.id));
  });
  return payload;
}

export async function dequeueHandlingRequest(
  db: Database,
  deviceIdentifier: string,
  commandUuid: string,
): Promise<HandlingRequest> {
  const [row] = await db
    .select()
    .from(mdmCommandHandlingRequests)
    .where(
      and(
        eq(mdmCommandHandlingRequests.deviceIdentifier, deviceIdentifier),
        eq(mdmCommandHandlingRequests.commandUuid, commandUuid),
      ),
    )
    .limit(1);
  if (!row) {
    throw new HandlingRequestNotFound(deviceIdentifier, commandUuid);
  }
  await db
    .delete(mdmCommandHandlingRequests)
    .where(eq(mdmCommandHandlingRequests.id, row.id));
  return {
    id: row.id,
    deviceIdentifier: row.deviceIdentifier,
    commandUuid: row.commandUuid,
    requestPayloadXml: row.requestPayload,
  };
}

export async function queueSize(db: Database, deviceIdentifier: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(mdmCommandRequests)
    .where(eq(mdmCommandRequests.deviceIdentifier, deviceIdentifier));
  return row?.value ?? 0;
}

export async function clearQueue(db: Database, deviceIdentifier: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(mdmCommandRequests)
      .where(eq(mdmCommandRequests.deviceIdentifier, deviceIdentifier));
    await tx
      .delete(mdmCommandHandlingRequests)
      .where(eq(mdmCommandHandlingRequests.deviceIdentifier, deviceIdentifier));
  });
}

export async function logCommandResult(
  db: Database,
  handling: { deviceIdentifier: string; commandUuid: string; requestPayloadXml: string },
  responsePayload: unknown,
): Promise<void> {
  const request = parsePlist(handling.requestPayloadXml) as {
    Command: { RequestType: string };
  };
  await db.insert(mdmCommandHistories).values({
    deviceIdentifier: handling.deviceIdentifier,
    requestType: request.Command.RequestType,
    commandUuid: handling.commandUuid,
    requestPayload: handling.requestPayloadXml,
    responsePayload: buildPlist(responsePayload),
    createdAt: new Date(),
  });
}
