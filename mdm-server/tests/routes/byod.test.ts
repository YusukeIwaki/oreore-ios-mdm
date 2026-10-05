import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "bun:test";
import { buildPlist, dataToBuffer, parsePlist } from "../../src/mdm/plist";
import {
  byodDevices,
  depServerTokens,
  getTokenTargets,
  managedAppleAccountAccessTokens,
  managedAppleAccounts,
} from "../../src/schema";
import { TEST_TOPIC, testApp } from "../helpers/app";
import { truncateAll } from "../db/helpers";

const ENROLLMENT_ID = "ENROLLMENT-0001";

async function createAccount(world: Awaited<ReturnType<typeof testApp>>, email: string) {
  const [account] = await world.db
    .insert(managedAppleAccounts)
    .values({ email, createdAt: new Date(), updatedAt: new Date() })
    .returning();
  return account!;
}

async function createToken(
  world: Awaited<ReturnType<typeof testApp>>,
  accountId: number,
  token = "token-abc",
) {
  const now = new Date();
  const [row] = await world.db
    .insert(managedAppleAccountAccessTokens)
    .values({
      managedAppleAccountId: accountId,
      token,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 3600_000),
      updatedAt: now,
    })
    .returning();
  return row!;
}

describe("BYOD routes", () => {
  let world: Awaited<ReturnType<typeof testApp>>;

  beforeEach(async () => {
    world = await testApp();
    await truncateAll(world.db);
  });

  test("enroll requires auth and serves a BYOD profile", async () => {
    const denied = await world.app.request("/mdm-byod/enroll", {
      method: "POST",
      body: new Uint8Array([1, 2, 3, 4]),
    });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("WWW-Authenticate")).toBe(
      'Bearer method="apple-as-web", url="https://mdm.example.com/mdm-byod/authenticate"',
    );

    // iOS 15 form-urlencoded quirk must not crash (Hono never parses implicitly).
    const quirk = await world.app.request("/mdm-byod/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "enroll_body=AAAA",
    });
    expect(quirk.status).toBe(401);

    const account = await createAccount(world, "byod@example.com");
    const token = await createToken(world, account.id);
    const res = await world.app.request("/mdm-byod/enroll", {
      method: "POST",
      headers: { Authorization: `Bearer ${token.token}` },
      body: new Uint8Array([9, 9, 9]),
    });
    expect(res.status).toBe(200);
    const payload = parsePlist(await res.text()) as {
      PayloadContent: Array<Record<string, unknown>>;
    };
    expect(payload.PayloadContent[1]!.EnrollmentMode).toBe("BYOD");
    expect(payload.PayloadContent[1]!.AssignedManagedAppleID).toBe("byod@example.com");
    expect("AccessRights" in payload.PayloadContent[1]!).toBe(false);
  });

  test("authenticate web flow", async () => {
    await createAccount(world, "byod@example.com");

    const list = await world.app.request("/mdm-byod/authenticate");
    expect(list.status).toBe(200);
    expect(await list.text()).toContain("byod@example.com");

    const form = await world.app.request("/mdm-byod/authenticate?email=byod@example.com");
    expect(form.status).toBe(200);
    expect(await form.text()).toContain("Input password!");

    const login = await world.app.request("/mdm-byod/authenticate", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: "byod@example.com", password: "password!" }).toString(),
    });
    expect(login.status).toBe(308);
    expect(login.headers.get("Location")).toMatch(
      /^apple-remotemanagement-user-login:\/\/authentication-results\?access-token=[0-9a-f]{48}$/,
    );

    const failed = await world.app.request("/mdm-byod/authenticate", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: "byod@example.com", password: "wrong" }).toString(),
    });
    expect(failed.status).toBe(200);
    expect(await failed.text()).toContain("Invalid password");
  });

  test("checkin enrolls with token usage tracking", async () => {
    const account = await createAccount(world, "byod@example.com");
    const token = await createToken(world, account.id);
    const auth = { Authorization: `Bearer ${token.token}` };
    const checkin = (body: unknown, headers: Record<string, string> = {}) =>
      world.app.request("/mdm-byod/checkin", {
        method: "PUT",
        headers,
        body: buildPlist(body),
      });

    const denied = await checkin({ MessageType: "TokenUpdate", EnrollmentID: ENROLLMENT_ID });
    expect(denied.status).toBe(401);

    const enrolled = await checkin(
      {
        MessageType: "TokenUpdate",
        EnrollmentID: ENROLLMENT_ID,
        PushMagic: "M1",
        Token: Buffer.from([0xab]),
        Topic: TEST_TOPIC,
      },
      auth,
    );
    expect(enrolled.status).toBe(200);
    const [device] = await world.db
      .select()
      .from(byodDevices)
      .where(eq(byodDevices.enrollmentId, ENROLLMENT_ID));
    expect(device).toBeDefined();

    // Same token on another device conflicts.
    const conflict = await checkin(
      {
        MessageType: "TokenUpdate",
        EnrollmentID: "ENROLLMENT-0002",
        PushMagic: "M1",
        Token: Buffer.from([0xab]),
        Topic: TEST_TOPIC,
      },
      auth,
    );
    expect(conflict.status).toBe(400);
    expect(await conflict.text()).toBe("Access token is already used by another device");

    const checkout = await checkin(
      { MessageType: "CheckOut", EnrollmentID: ENROLLMENT_ID, Topic: TEST_TOPIC },
      auth,
    );
    expect(checkout.status).toBe(200);
    expect(await world.db.select().from(byodDevices)).toHaveLength(0);
  });

  test("checkin GetToken is keyed by EnrollmentID", async () => {
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
    const res = await world.app.request("/mdm-byod/checkin", {
      method: "PUT",
      body: buildPlist({ MessageType: "GetToken", EnrollmentID: ENROLLMENT_ID, TokenServiceType: "com.apple.maid" }),
    });
    expect(res.status).toBe(200);
    expect(dataToBuffer((parsePlist(await res.text()) as Record<string, unknown>).TokenData).toString("utf8").split(".")).toHaveLength(3);
  });

  test("command requires auth and round-trips", async () => {
    const account = await createAccount(world, "byod@example.com");
    const token = await createToken(world, account.id);
    const auth = { Authorization: `Bearer ${token.token}` };
    await world.app.request("/mdm-byod/checkin", {
      method: "PUT",
      headers: auth,
      body: buildPlist({
        MessageType: "TokenUpdate",
        EnrollmentID: ENROLLMENT_ID,
        PushMagic: "M1",
        Token: Buffer.from([1]),
        Topic: TEST_TOPIC,
      }),
    });

    const denied = await world.app.request("/mdm-byod/command", {
      method: "PUT",
      body: buildPlist({ Status: "Idle", EnrollmentID: ENROLLMENT_ID }),
    });
    expect(denied.status).toBe(401);

    const { enqueueCommand } = await import("../../src/db/queue");
    const { deviceInformation } = await import("../../src/mdm/commands");
    await enqueueCommand(world.db, ENROLLMENT_ID, deviceInformation({ commandUuid: "cmd-1" }));

    const idle = await world.app.request("/mdm-byod/command", {
      method: "PUT",
      headers: auth,
      body: buildPlist({ Status: "Idle", EnrollmentID: ENROLLMENT_ID }),
    });
    expect(parsePlist(await idle.text())).toMatchObject({ CommandUUID: "cmd-1" });

    const ack = await world.app.request("/mdm-byod/command", {
      method: "PUT",
      headers: auth,
      body: buildPlist({ Status: "Acknowledged", EnrollmentID: ENROLLMENT_ID, CommandUUID: "cmd-1" }),
    });
    expect(ack.status).toBe(200);
  });
});
