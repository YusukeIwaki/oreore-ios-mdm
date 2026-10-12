import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "bun:test";
import { buildPlist, dataToBuffer, parsePlist } from "../../src/mdm/plist";
import {
  depServerTokens,
  getTokenTargets,
  managedAppleAccountAccessTokens,
  managedAppleAccounts,
  mdmDevices,
} from "../../src/schema";
import { TEST_TOPIC, testApp } from "../helpers/app";
import { truncateAll } from "../db/helpers";

const UDID = "ADDE-UDID-0001";
const SERIAL = "ADDESERIAL001";

describe("ADDE routes", () => {
  let world: Awaited<ReturnType<typeof testApp>>;

  beforeEach(async () => {
    world = await testApp();
    await truncateAll(world.db);
  });

  async function accountWithToken(email = "adde@example.com", token = "token-adde") {
    const [account] = await world.db
      .insert(managedAppleAccounts)
      .values({ email, createdAt: new Date(), updatedAt: new Date() })
      .returning();
    const now = new Date();
    const [row] = await world.db
      .insert(managedAppleAccountAccessTokens)
      .values({
        managedAppleAccountId: account!.id,
        token,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 3600_000),
        updatedAt: now,
      })
      .returning();
    return { account: account!, token: row! };
  }

  test("enroll serves an ADDE profile to authorized accounts", async () => {
    const denied = await world.app.request("/mdm-adde/enroll", { method: "POST" });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("WWW-Authenticate")).toBe(
      'Bearer method="apple-as-web", url="https://mdm.example.com/mdm-adde/authenticate"',
    );

    const { token } = await accountWithToken();
    const res = await world.app.request("/mdm-adde/enroll", {
      method: "POST",
      headers: { Authorization: `Bearer ${token.token}` },
    });
    expect(res.status).toBe(200);
    const payload = parsePlist(await res.text()) as {
      PayloadContent: Array<Record<string, unknown>>;
    };
    expect(payload.PayloadContent[1]!.EnrollmentMode).toBe("ADDE");
    expect(payload.PayloadContent[1]!.AccessRights).toBe(8191);
    expect(payload.PayloadContent[1]!.AssignedManagedAppleID).toBe("adde@example.com");
  });

  test("authenticate uses PASSWORD!", async () => {
    await accountWithToken();
    const list = await world.app.request("/mdm-adde/authenticate?user-identifier=u@e.c");
    expect(await list.text()).toContain("Device enrollment request from");

    const login = await world.app.request("/mdm-adde/authenticate", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: "adde@example.com", password: "PASSWORD!" }).toString(),
    });
    expect(login.status).toBe(308);
    expect(login.headers.get("Location")).toMatch(/access-token=[0-9a-f]{48}$/);

    const failed = await world.app.request("/mdm-adde/authenticate", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: "adde@example.com", password: "password!" }).toString(),
    });
    expect(await failed.text()).toContain("Invalid password");
  });

  test("checkin enrolls UDID-keyed devices with usage tracking", async () => {
    const { token } = await accountWithToken();
    const auth = { Authorization: `Bearer ${token.token}` };
    const checkin = (body: unknown, headers: Record<string, string> = {}) =>
      world.app.request("/mdm-adde/checkin", { method: "PUT", headers, body: buildPlist(body) });

    expect((await checkin({ MessageType: "Authenticate", UDID, SerialNumber: SERIAL, Topic: TEST_TOPIC })).status).toBe(401);

    const authRes = await checkin(
      { MessageType: "Authenticate", UDID, SerialNumber: SERIAL, Topic: TEST_TOPIC },
      auth,
    );
    expect(authRes.status).toBe(200);
    const tokenRes = await checkin(
      { MessageType: "TokenUpdate", UDID, PushMagic: "M1", Token: Buffer.from([7]), Topic: TEST_TOPIC },
      auth,
    );
    expect(tokenRes.status).toBe(200);
    const [device] = await world.db.select().from(mdmDevices).where(eq(mdmDevices.udid, UDID));
    expect(device).toMatchObject({ serialNumber: SERIAL });

    const mismatch = await checkin(
      { MessageType: "Authenticate", UDID, SerialNumber: SERIAL, Topic: "wrong" },
      auth,
    );
    expect(mismatch.status).toBe(403);

    const checkout = await checkin({ MessageType: "CheckOut", UDID, Topic: TEST_TOPIC }, auth);
    expect(checkout.status).toBe(200);
    expect(await world.db.select().from(mdmDevices)).toHaveLength(0);
  });

  test("checkin GetToken and DeclarativeManagement branches", async () => {
    const [dep] = await world.db
      .insert(depServerTokens)
      .values({
        filename: "t.p7m",
        consumerKey: "ck",
        consumerSecret: "cs",
        accessToken: "at",
        accessSecret: "as",
        accessTokenExpiry: new Date(),
      })
      .returning({ id: depServerTokens.id });
    await world.db.insert(getTokenTargets).values({
      depServerTokenId: dep!.id,
      serverUuid: "server-uuid-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { token } = await accountWithToken();
    const auth = { Authorization: `Bearer ${token.token}` };

    const getToken = await world.app.request("/mdm-adde/checkin", {
      method: "PUT",
      body: buildPlist({ MessageType: "GetToken", UDID, TokenServiceType: "com.apple.maid" }),
    });
    expect(getToken.status).toBe(200);
    expect(
      dataToBuffer((parsePlist(await getToken.text()) as Record<string, unknown>).TokenData)
        .toString("utf8")
        .split("."),
    ).toHaveLength(3);

    await world.app.request("/mdm-adde/checkin", {
      method: "PUT",
      headers: auth,
      body: buildPlist({ MessageType: "Authenticate", UDID, SerialNumber: SERIAL, Topic: TEST_TOPIC }),
    });
    await world.app.request("/mdm-adde/checkin", {
      method: "PUT",
      headers: auth,
      body: buildPlist({ MessageType: "TokenUpdate", UDID, PushMagic: "M1", Token: Buffer.from([7]), Topic: TEST_TOPIC }),
    });
    const dm = await world.app.request("/mdm-adde/checkin", {
      method: "PUT",
      headers: auth,
      body: buildPlist({ MessageType: "DeclarativeManagement", UDID, Endpoint: "tokens" }),
    });
    expect(dm.status).toBe(200);
    expect(Object.keys(((await dm.json()) as { SyncTokens: object }).SyncTokens).sort()).toEqual([
      "DeclarationsToken",
      "Timestamp",
    ]);
  });

  test("command requires auth and round-trips", async () => {
    const { token } = await accountWithToken();
    const auth = { Authorization: `Bearer ${token.token}` };
    await world.app.request("/mdm-adde/checkin", {
      method: "PUT",
      headers: auth,
      body: buildPlist({ MessageType: "Authenticate", UDID, SerialNumber: SERIAL, Topic: TEST_TOPIC }),
    });
    await world.app.request("/mdm-adde/checkin", {
      method: "PUT",
      headers: auth,
      body: buildPlist({ MessageType: "TokenUpdate", UDID, PushMagic: "M1", Token: Buffer.from([7]), Topic: TEST_TOPIC }),
    });

    const denied = await world.app.request("/mdm-adde/command", {
      method: "PUT",
      body: buildPlist({ Status: "Idle", UDID }),
    });
    expect(denied.status).toBe(401);

    const { enqueueCommand } = await import("../../src/db/queue");
    const { deviceInformation } = await import("../../src/mdm/commands");
    await enqueueCommand(world.db, UDID, deviceInformation({ commandUuid: "cmd-1" }));
    const idle = await world.app.request("/mdm-adde/command", {
      method: "PUT",
      headers: auth,
      body: buildPlist({ Status: "Idle", UDID }),
    });
    expect(parsePlist(await idle.text())).toMatchObject({ CommandUUID: "cmd-1" });
  });
});
