import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "bun:test";
import { buildPlist, dataToBuffer, parsePlist } from "../../src/mdm/plist";
import {
  ddmActivationTargets,
  ddmActivations,
  ddmConfigurations,
  ddmPublicAssetDetails,
  ddmPublicAssets,
  ddmSynchronizationRequestHistories,
  depServerTokens,
  getTokenHistories,
  getTokenTargets,
  mdmCommandHistories,
  mdmDevices,
} from "../../src/schema";
import { formatStoredFileData } from "../../src/storage/files";
import { TEST_TOPIC, testApp } from "../helpers/app";
import { truncateAll } from "../db/helpers";

const UDID = "TEST-UDID-0001";
const SERIAL = "TESTSERIAL001";

function plist(body: string): Record<string, unknown> {
  return parsePlist(body) as Record<string, unknown>;
}

async function enrollDevice(world: Awaited<ReturnType<typeof testApp>>) {
  const { app } = world;
  await app.request("/mdm/checkin", {
    method: "PUT",
    body: buildPlist({ MessageType: "Authenticate", UDID, SerialNumber: SERIAL, Topic: TEST_TOPIC }),
  });
  await app.request("/mdm/checkin", {
    method: "PUT",
    body: buildPlist({
      MessageType: "TokenUpdate",
      UDID,
      PushMagic: "MAGIC-1",
      Token: Buffer.from([1, 2, 3, 4]),
      Topic: TEST_TOPIC,
    }),
  });
}

async function seedGetTokenTarget(world: Awaited<ReturnType<typeof testApp>>) {
  const [token] = await world.db
    .insert(depServerTokens)
    .values({
      filename: "token.p7m",
      consumerKey: "ck",
      consumerSecret: "cs",
      accessToken: "at",
      accessSecret: "as",
      accessTokenExpiry: new Date("2026-01-01T00:00:00Z"),
    })
    .returning({ id: depServerTokens.id });
  await world.db.insert(getTokenTargets).values({
    depServerTokenId: token!.id,
    serverUuid: "server-uuid-1",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function seedDdm(world: Awaited<ReturnType<typeof testApp>>) {
  const [activation] = await world.db
    .insert(ddmActivations)
    .values({
      name: "apply_wifi",
      type: "com.apple.activation.simple",
      payload: JSON.stringify({ StandardConfigurations: ["@configuration/wifi"] }),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({ id: ddmActivations.id });
  await world.db.insert(ddmActivationTargets).values({
    ddmActivationId: activation!.id,
    targetIdentifier: null,
    createdAt: new Date(),
  });
  await world.db.insert(ddmConfigurations).values({
    name: "wifi",
    type: "com.apple.configuration.legacy",
    payload: JSON.stringify({ ProfileURL: "@public/wifi_file" }),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [asset] = await world.db
    .insert(ddmPublicAssets)
    .values({ name: "wifi_file", createdAt: new Date(), updatedAt: new Date() })
    .returning({ id: ddmPublicAssets.id });
  const stored = await world.fileStore.upload({
    bytes: new TextEncoder().encode("wifi-bytes"),
    filename: "wifi.mobileconfig",
  });
  await world.db.insert(ddmPublicAssetDetails).values({
    ddmPublicAssetId: asset!.id,
    targetIdentifier: null,
    assetFileData: formatStoredFileData(stored),
    createdAt: new Date(),
  });
}

describe("MDM protocol routes", () => {
  let world: Awaited<ReturnType<typeof testApp>>;

  beforeEach(async () => {
    world = await testApp();
    await truncateAll(world.db);
  });

  test("checkin enrolls a device", async () => {
    const auth = await world.app.request("/mdm/checkin", {
      method: "PUT",
      body: buildPlist({ MessageType: "Authenticate", UDID, SerialNumber: SERIAL, Topic: TEST_TOPIC }),
    });
    expect(auth.status).toBe(200);
    expect(await auth.text()).toBe("OK");

    const tokenUpdate = await world.app.request("/mdm/checkin", {
      method: "PUT",
      body: buildPlist({
        MessageType: "TokenUpdate",
        UDID,
        PushMagic: "MAGIC-1",
        Token: Buffer.from([0xde, 0xad]),
        Topic: TEST_TOPIC,
      }),
    });
    expect(tokenUpdate.status).toBe(200);
    const [device] = await world.db.select().from(mdmDevices).where(eq(mdmDevices.udid, UDID));
    expect(device).toMatchObject({ udid: UDID, serialNumber: SERIAL });

    const mismatch = await world.app.request("/mdm/checkin", {
      method: "PUT",
      body: buildPlist({ MessageType: "Authenticate", UDID, SerialNumber: SERIAL, Topic: "wrong" }),
    });
    expect(mismatch.status).toBe(403);

    const unknown = await world.app.request("/mdm/checkin", {
      method: "PUT",
      body: buildPlist({ MessageType: "Bogus", UDID, Topic: TEST_TOPIC }),
    });
    expect(unknown.status).toBe(500);
  });

  test("checkin CheckOut removes the device", async () => {
    await enrollDevice(world);
    const res = await world.app.request("/mdm/checkin", {
      method: "PUT",
      body: buildPlist({ MessageType: "CheckOut", UDID, Topic: TEST_TOPIC }),
    });
    expect(res.status).toBe(200);
    expect(await world.db.select().from(mdmDevices)).toHaveLength(0);
  });

  test("GetToken issues and reuses JWTs", async () => {
    await seedGetTokenTarget(world);
    const first = await world.app.request("/mdm/checkin", {
      method: "PUT",
      body: buildPlist({ MessageType: "GetToken", UDID, TokenServiceType: "com.apple.maid", Topic: "ignored" }),
    });
    expect(first.status).toBe(200);
    expect(first.headers.get("Content-Type")).toContain("application/xml");
    const firstToken = dataToBuffer(plist(await first.text()).TokenData).toString("utf8");
    expect(firstToken.split(".")).toHaveLength(3);

    const second = await world.app.request("/mdm/checkin", {
      method: "PUT",
      body: buildPlist({ MessageType: "GetToken", UDID, TokenServiceType: "com.apple.maid", Topic: "ignored" }),
    });
    expect(dataToBuffer(plist(await second.text()).TokenData).toString("utf8")).toBe(firstToken);
    expect(await world.db.select().from(getTokenHistories)).toHaveLength(1);

    const wrongType = await world.app.request("/mdm/checkin", {
      method: "PUT",
      body: buildPlist({ MessageType: "GetToken", UDID, TokenServiceType: "com.apple.other", Topic: "ignored" }),
    });
    expect(wrongType.status).toBe(400);
  });

  test("DeclarativeManagement serves tokens, items, details, and status", async () => {
    await enrollDevice(world);
    await seedDdm(world);
    const dm = (endpoint: string, data: unknown = null) =>
      world.app.request("/mdm/checkin", {
        method: "PUT",
        body: buildPlist({
          MessageType: "DeclarativeManagement",
          UDID,
          Endpoint: endpoint,
          ...(data === null ? {} : { Data: Buffer.from(JSON.stringify(data), "utf8") }),
        }),
      });

    const tokens = await dm("tokens");
    expect(tokens.status).toBe(200);
    const tokensJson = (await tokens.json()) as { SyncTokens: Record<string, string> };
    expect(Object.keys(tokensJson.SyncTokens).sort()).toEqual(["DeclarationsToken", "Timestamp"]);

    const items = await dm("declaration-items");
    const itemsJson = (await items.json()) as {
      Declarations: { Activations: unknown[]; Configurations: unknown[] };
      DeclarationsToken: string;
    };
    expect(itemsJson.Declarations.Activations).toHaveLength(1);
    expect(itemsJson.Declarations.Configurations).toHaveLength(1);
    expect(itemsJson.DeclarationsToken).toBe(tokensJson.SyncTokens.DeclarationsToken);

    const status = await dm("status", { DeclarationsToken: "x ’non-ascii’" });
    expect(status.status).toBe(200);
    expect(await status.json()).toBeNull();

    const missing = await dm("nope");
    expect(missing.status).toBe(404);
    const histories = await world.db.select().from(ddmSynchronizationRequestHistories);
    expect(histories).toHaveLength(4);

    const noEndpoint = await world.app.request("/mdm/checkin", {
      method: "PUT",
      body: buildPlist({ MessageType: "DeclarativeManagement", UDID }),
    });
    expect(noEndpoint.status).toBe(400);
  });

  test("command round-trips Idle/Acknowledged/NotNow", async () => {
    await enrollDevice(world);
    const { enqueueCommand } = await import("../../src/db/queue");
    const { deviceInformation } = await import("../../src/mdm/commands");
    await enqueueCommand(world.db, UDID, deviceInformation({ commandUuid: "cmd-1" }));

    const idle = await world.app.request("/mdm/command", {
      method: "PUT",
      body: buildPlist({ Status: "Idle", UDID }),
    });
    expect(idle.status).toBe(200);
    expect(plist(await idle.text())).toMatchObject({
      CommandUUID: "cmd-1",
      Command: { RequestType: "DeviceInformation" },
    });

    const idleAgain = await world.app.request("/mdm/command", {
      method: "PUT",
      body: buildPlist({ Status: "Idle", UDID }),
    });
    expect(await idleAgain.text()).toBe("");

    const ack = await world.app.request("/mdm/command", {
      method: "PUT",
      body: buildPlist({ Status: "Acknowledged", UDID, CommandUUID: "cmd-1", QueryResponses: {} }),
    });
    expect(ack.status).toBe(200);
    const histories = await world.db
      .select()
      .from(mdmCommandHistories)
      .where(eq(mdmCommandHistories.deviceIdentifier, UDID));
    expect(histories).toHaveLength(1);
    expect(histories[0]).toMatchObject({ requestType: "DeviceInformation", commandUuid: "cmd-1" });

    // Unknown CommandUUID only warns (iOS retry).
    const retry = await world.app.request("/mdm/command", {
      method: "PUT",
      body: buildPlist({ Status: "Acknowledged", UDID, CommandUUID: "cmd-1" }),
    });
    expect(retry.status).toBe(200);

    // NotNow re-enqueues.
    await enqueueCommand(world.db, UDID, deviceInformation({ commandUuid: "cmd-2" }));
    await world.app.request("/mdm/command", {
      method: "PUT",
      body: buildPlist({ Status: "Idle", UDID }),
    });
    const notNow = await world.app.request("/mdm/command", {
      method: "PUT",
      body: buildPlist({ Status: "NotNow", UDID, CommandUUID: "cmd-2" }),
    });
    expect(notNow.status).toBe(200);
    const redelivered = await world.app.request("/mdm/command", {
      method: "PUT",
      body: buildPlist({ Status: "Idle", UDID }),
    });
    expect(plist(await redelivered.text())).toMatchObject({ CommandUUID: "cmd-2" });

    const bad = await world.app.request("/mdm/command", {
      method: "PUT",
      body: buildPlist({ Status: "Idle" }),
    });
    expect(bad.status).toBe(400);
  });
});
