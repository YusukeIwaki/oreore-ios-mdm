import { eq } from "drizzle-orm";
import { dataToBuffer } from "../mdm/plist";
import type { Database } from "../db";
import {
  byodDevices,
  byodPushEndpoints,
  ddmSynchronizationRequestHistories,
  mdmCommandHistories,
  mdmDevices,
  mdmPushEndpoints,
  pendingCheckins,
} from "../schema";
import { clearQueue } from "./queue";

/**
 * MDM checkin message handlers (ported from `CheckinRequest::*` and
 * `ByodCheckinRequest::*`). Input is an already-parsed plist dictionary.
 */
export class RecordNotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordNotFound";
  }
}

export function tokenHex(data: unknown): string {
  return dataToBuffer(data).toString("hex");
}

function plistString(plist: Record<string, unknown>, key: string): string {
  const value = plist[key];
  if (typeof value !== "string") {
    throw new TypeError(`checkin plist has no string ${key}`);
  }
  return value;
}

function optionalTokenHex(plist: Record<string, unknown>, key: string): string | null {
  return plist[key] === undefined || plist[key] === null ? null : tokenHex(plist[key]);
}

/** `Authenticate`: stage UDID/IMEI/serial into `pending_checkins` (upsert). */
export async function handleAuthenticate(
  db: Database,
  plist: Record<string, unknown>,
): Promise<void> {
  const udid = plistString(plist, "UDID");
  const serialNumber = plistString(plist, "SerialNumber");
  const imeiRaw = plist.IMEI;
  const imei = typeof imeiRaw === "string" ? imeiRaw.replace(/\s/g, "") : null;
  const [existing] = await db
    .select()
    .from(pendingCheckins)
    .where(eq(pendingCheckins.udid, udid))
    .limit(1);
  if (existing) {
    await db
      .update(pendingCheckins)
      .set({ imei, serialNumber, updatedAt: new Date() })
      .where(eq(pendingCheckins.id, existing.id));
  } else {
    await db.insert(pendingCheckins).values({
      udid,
      imei,
      serialNumber,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

/** `TokenUpdate`: enroll or refresh the device + push endpoint. */
export async function handleTokenUpdate(
  db: Database,
  plist: Record<string, unknown>,
): Promise<void> {
  const udid = plistString(plist, "UDID");
  const pushMagic = plistString(plist, "PushMagic");
  const token = tokenHex(plist.Token);
  const unlockToken = optionalTokenHex(plist, "UnlockToken");

  const [pending] = await db
    .select()
    .from(pendingCheckins)
    .where(eq(pendingCheckins.udid, udid))
    .limit(1);
  if (!pending) {
    const [device] = await db
      .select()
      .from(mdmDevices)
      .where(eq(mdmDevices.udid, udid))
      .limit(1);
    if (!device) {
      throw new RecordNotFound(`no MdmDevice with udid ${udid}`);
    }
    // `.compact`: a missing UnlockToken must not overwrite the stored one.
    await db
      .update(mdmPushEndpoints)
      .set({
        ...(unlockToken === null ? { token, pushMagic } : { token, pushMagic, unlockToken }),
        updatedAt: new Date(),
      })
      .where(eq(mdmPushEndpoints.mdmDeviceId, device.id));
    return;
  }

  const [device] = await db
    .select()
    .from(mdmDevices)
    .where(eq(mdmDevices.udid, udid))
    .limit(1);
  if (device) {
    await db.transaction(async (tx) => {
      await tx
        .update(mdmPushEndpoints)
        .set({ token, pushMagic, unlockToken, updatedAt: new Date() })
        .where(eq(mdmPushEndpoints.mdmDeviceId, device.id));
      await tx.delete(pendingCheckins).where(eq(pendingCheckins.id, pending.id));
    });
  } else {
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(mdmDevices)
        .values({
          udid,
          imei: pending.imei,
          serialNumber: pending.serialNumber,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: mdmDevices.id });
      await tx.insert(mdmPushEndpoints).values({
        mdmDeviceId: created!.id,
        token,
        pushMagic,
        unlockToken,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await tx.delete(pendingCheckins).where(eq(pendingCheckins.id, pending.id));
    });
  }
}

/** `CheckOut`: wipe all device state (destructive, like the Ruby handler). */
export async function handleCheckOut(
  db: Database,
  plist: Record<string, unknown>,
): Promise<void> {
  const udid = plistString(plist, "UDID");
  const [device] = await db
    .select()
    .from(mdmDevices)
    .where(eq(mdmDevices.udid, udid))
    .limit(1);
  if (!device) {
    throw new RecordNotFound(`no MdmDevice with udid ${udid}`);
  }
  await clearQueue(db, udid);
  await db.delete(mdmCommandHistories).where(eq(mdmCommandHistories.deviceIdentifier, udid));
  await db.delete(mdmPushEndpoints).where(eq(mdmPushEndpoints.mdmDeviceId, device.id));
  await db.delete(mdmDevices).where(eq(mdmDevices.id, device.id));
  await db
    .delete(ddmSynchronizationRequestHistories)
    .where(eq(ddmSynchronizationRequestHistories.deviceIdentifier, udid));
}

/** BYOD `Authenticate`: no-op stub, mirroring the Ruby handler. */
export async function handleByodAuthenticate(
  _db: Database,
  _plist: Record<string, unknown>,
): Promise<void> {
  // Intentionally empty.
}

/** BYOD `TokenUpdate`: enroll or refresh the BYOD device + push endpoint. */
export async function handleByodTokenUpdate(
  db: Database,
  plist: Record<string, unknown>,
): Promise<void> {
  const enrollmentId = plistString(plist, "EnrollmentID");
  const pushMagic = plistString(plist, "PushMagic");
  const token = tokenHex(plist.Token);

  const [device] = await db
    .select()
    .from(byodDevices)
    .where(eq(byodDevices.enrollmentId, enrollmentId))
    .limit(1);
  if (device) {
    const [endpoint] = await db
      .select()
      .from(byodPushEndpoints)
      .where(eq(byodPushEndpoints.byodDeviceId, device.id))
      .limit(1);
    if (!endpoint) {
      throw new RecordNotFound(`no push endpoint for enrollment ${enrollmentId}`);
    }
    await db
      .update(byodPushEndpoints)
      .set({ token, pushMagic, updatedAt: new Date() })
      .where(eq(byodPushEndpoints.id, endpoint.id));
  } else {
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(byodDevices)
        .values({ enrollmentId, createdAt: new Date() })
        .returning({ id: byodDevices.id });
      await tx.insert(byodPushEndpoints).values({
        byodDeviceId: created!.id,
        token,
        pushMagic,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
  }
}

/** BYOD `CheckOut`: wipe BYOD device state. */
export async function handleByodCheckOut(
  db: Database,
  plist: Record<string, unknown>,
): Promise<void> {
  const enrollmentId = plistString(plist, "EnrollmentID");
  const [device] = await db
    .select()
    .from(byodDevices)
    .where(eq(byodDevices.enrollmentId, enrollmentId))
    .limit(1);
  if (!device) {
    throw new RecordNotFound(`no ByodDevice with enrollment ${enrollmentId}`);
  }
  await clearQueue(db, enrollmentId);
  await db
    .delete(mdmCommandHistories)
    .where(eq(mdmCommandHistories.deviceIdentifier, enrollmentId));
  await db.delete(byodPushEndpoints).where(eq(byodPushEndpoints.byodDeviceId, device.id));
  await db.delete(byodDevices).where(eq(byodDevices.id, device.id));
  // NOTE: DDM history cleanup is commented out in the Ruby handler too.
}
