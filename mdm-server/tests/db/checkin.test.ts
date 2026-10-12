import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "bun:test";
import {
  handleAuthenticate,
  handleByodCheckOut,
  handleByodTokenUpdate,
  handleCheckOut,
  handleTokenUpdate,
  RecordNotFound,
} from "../../src/db/checkin";
import { enqueueCommand } from "../../src/db/queue";
import {
  byodDevices,
  byodPushEndpoints,
  mdmDevices,
  mdmPushEndpoints,
  pendingCheckins,
} from "../../src/schema";
import { testDb, truncateAll } from "./helpers";

describe("checkin handlers", () => {
  const db = testDb();

  beforeEach(async () => {
    await truncateAll(db);
  });

  test("Authenticate upserts pending checkins and strips IMEI whitespace", async () => {
    await handleAuthenticate(db, {
      UDID: "UDID-1",
      SerialNumber: "SERIAL-1",
      IMEI: "35 111111 222222 3",
    });
    await handleAuthenticate(db, { UDID: "UDID-1", SerialNumber: "SERIAL-1B" });
    const rows = await db.select().from(pendingCheckins);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      udid: "UDID-1",
      serialNumber: "SERIAL-1B",
      imei: null,
    });

    await handleAuthenticate(db, {
      UDID: "UDID-2",
      SerialNumber: "S2",
      IMEI: "35 111111 222222 3",
    });
    const [row] = await db
      .select()
      .from(pendingCheckins)
      .where(eq(pendingCheckins.udid, "UDID-2"));
    expect(row!.imei).toBe("351111112222223");
  });

  test("TokenUpdate after Authenticate enrolls the device", async () => {
    await handleAuthenticate(db, { UDID: "UDID-1", SerialNumber: "SERIAL-1", IMEI: "123" });
    await handleTokenUpdate(db, {
      UDID: "UDID-1",
      PushMagic: "MAGIC-1",
      Token: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
      UnlockToken: Buffer.from([0x01, 0x02]),
    });

    const [device] = await db.select().from(mdmDevices);
    expect(device).toMatchObject({ udid: "UDID-1", serialNumber: "SERIAL-1", imei: "123" });
    const [endpoint] = await db.select().from(mdmPushEndpoints);
    expect(endpoint).toMatchObject({
      mdmDeviceId: device!.id,
      token: "deadbeef",
      pushMagic: "MAGIC-1",
      unlockToken: "0102",
    });
    expect(await db.select().from(pendingCheckins)).toHaveLength(0);
  });

  test("TokenUpdate without Authenticate refreshes a known device", async () => {
    await handleAuthenticate(db, { UDID: "UDID-1", SerialNumber: "S1" });
    await handleTokenUpdate(db, {
      UDID: "UDID-1",
      PushMagic: "M1",
      Token: Buffer.from([1]),
      UnlockToken: Buffer.from([2]),
    });
    // No UnlockToken: stored value must survive (`.compact` parity).
    await handleTokenUpdate(db, {
      UDID: "UDID-1",
      PushMagic: "M2",
      Token: Buffer.from([3]),
    });
    const [endpoint] = await db.select().from(mdmPushEndpoints);
    expect(endpoint).toMatchObject({ token: "03", pushMagic: "M2", unlockToken: "02" });

    await expect(
      handleTokenUpdate(db, { UDID: "UNKNOWN", PushMagic: "M", Token: Buffer.from([1]) }),
    ).rejects.toBeInstanceOf(RecordNotFound);
  });

  test("CheckOut wipes all device state", async () => {
    await handleAuthenticate(db, { UDID: "UDID-1", SerialNumber: "S1" });
    await handleTokenUpdate(db, {
      UDID: "UDID-1",
      PushMagic: "M1",
      Token: Buffer.from([1]),
    });
    await enqueueCommand(db, "UDID-1", { CommandUUID: "u", Command: {} });
    await handleCheckOut(db, { UDID: "UDID-1" });
    expect(await db.select().from(mdmDevices)).toHaveLength(0);
    expect(await db.select().from(mdmPushEndpoints)).toHaveLength(0);

    await expect(handleCheckOut(db, { UDID: "UDID-1" })).rejects.toBeInstanceOf(RecordNotFound);
  });

  test("BYOD TokenUpdate enrolls and refreshes", async () => {
    await handleByodTokenUpdate(db, {
      EnrollmentID: "ENROLL-1",
      PushMagic: "M1",
      Token: Buffer.from([0xab, 0xcd]),
    });
    const [device] = await db
      .select()
      .from(byodDevices)
      .where(eq(byodDevices.enrollmentId, "ENROLL-1"));
    expect(device).toBeDefined();
    const [endpoint] = await db.select().from(byodPushEndpoints);
    expect(endpoint).toMatchObject({
      byodDeviceId: device!.id,
      token: "abcd",
      pushMagic: "M1",
    });

    await handleByodTokenUpdate(db, {
      EnrollmentID: "ENROLL-1",
      PushMagic: "M2",
      Token: Buffer.from([1]),
    });
    const [updated] = await db.select().from(byodPushEndpoints);
    expect(updated).toMatchObject({ token: "01", pushMagic: "M2" });
  });

  test("BYOD CheckOut wipes BYOD state", async () => {
    await handleByodTokenUpdate(db, {
      EnrollmentID: "ENROLL-1",
      PushMagic: "M1",
      Token: Buffer.from([1]),
    });
    await enqueueCommand(db, "ENROLL-1", { CommandUUID: "u", Command: {} });
    await handleByodCheckOut(db, { EnrollmentID: "ENROLL-1" });
    expect(await db.select().from(byodDevices)).toHaveLength(0);
    expect(await db.select().from(byodPushEndpoints)).toHaveLength(0);
    await expect(handleByodCheckOut(db, { EnrollmentID: "ENROLL-1" })).rejects.toBeInstanceOf(
      RecordNotFound,
    );
  });
});
