import { eq } from "drizzle-orm";
import type { Database } from "../db";
import {
  byodDevices,
  byodPushEndpoints,
  managedAppleAccountAccessTokenUsages,
  managedAppleAccountAccessTokens,
  managedAppleAccounts,
  mdmDevices,
  mdmPushEndpoints,
} from "../schema";
import { RecordNotFound } from "./accounts";

export type MdmDeviceRow = typeof mdmDevices.$inferSelect;
export type ByodDeviceRow = typeof byodDevices.$inferSelect;

export async function findMdmDeviceByUdid(db: Database, udid: string): Promise<MdmDeviceRow> {
  const [row] = await db.select().from(mdmDevices).where(eq(mdmDevices.udid, udid)).limit(1);
  if (!row) {
    throw new RecordNotFound(`no MdmDevice with udid ${udid}`);
  }
  return row;
}

export async function findByodDeviceByEnrollmentId(
  db: Database,
  enrollmentId: string,
): Promise<ByodDeviceRow> {
  const [row] = await db
    .select()
    .from(byodDevices)
    .where(eq(byodDevices.enrollmentId, enrollmentId))
    .limit(1);
  if (!row) {
    throw new RecordNotFound(`no ByodDevice with enrollment ${enrollmentId}`);
  }
  return row;
}

export async function findMdmPushEndpoint(db: Database, deviceId: number) {
  const [row] = await db
    .select()
    .from(mdmPushEndpoints)
    .where(eq(mdmPushEndpoints.mdmDeviceId, deviceId))
    .limit(1);
  return row ?? null;
}

export async function findByodPushEndpoint(db: Database, deviceId: number) {
  const [row] = await db
    .select()
    .from(byodPushEndpoints)
    .where(eq(byodPushEndpoints.byodDeviceId, deviceId))
    .limit(1);
  return row ?? null;
}

/** The managed account enrolled on a device, via token usage (or null). */
export async function findAccountForDevice(
  db: Database,
  deviceIdentifier: string,
): Promise<{ id: number; email: string } | null> {
  const [usage] = await db
    .select()
    .from(managedAppleAccountAccessTokenUsages)
    .where(eq(managedAppleAccountAccessTokenUsages.deviceIdentifier, deviceIdentifier))
    .limit(1);
  if (!usage) {
    return null;
  }
  const [token] = await db
    .select()
    .from(managedAppleAccountAccessTokens)
    .where(eq(managedAppleAccountAccessTokens.id, usage.managedAppleAccountAccessTokenId))
    .limit(1);
  if (!token) {
    return null;
  }
  const [account] = await db
    .select()
    .from(managedAppleAccounts)
    .where(eq(managedAppleAccounts.id, token.managedAppleAccountId))
    .limit(1);
  return account ? { id: account.id, email: account.email } : null;
}
