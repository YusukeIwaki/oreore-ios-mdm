import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/index";
import { ipaFiles, mdmDevices, mdmPushEndpoints } from "../../src/schema";
import { formatStoredFileData } from "../../src/storage/files";
import { testApp } from "../helpers/app";
import { truncateAll } from "../db/helpers";

describe("API v1", () => {
  let world: Awaited<ReturnType<typeof testApp>>;

  beforeEach(async () => {
    world = await testApp();
    await truncateAll(world.db);
    world.sentPushes.length = 0;
  });

  const auth = { Authorization: "Bearer api-token-test" };

  async function seedDevice(udid: string, serial: string, withEndpoint = true) {
    const [device] = await world.db
      .insert(mdmDevices)
      .values({ udid, serialNumber: serial, createdAt: new Date(), updatedAt: new Date() })
      .returning();
    if (withEndpoint) {
      await world.db.insert(mdmPushEndpoints).values({
        mdmDeviceId: device!.id,
        token: `token-${udid}`,
        pushMagic: `magic-${udid}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    return device!;
  }

  async function seedIpa(filename = "ExampleApp.ipa") {
    const stored = await world.fileStore.upload({
      bytes: new TextEncoder().encode("fake-ipa-bytes"),
      filename,
      contentType: "application/octet-stream",
    });
    const [row] = await world.db
      .insert(ipaFiles)
      .values({
        filename,
        bundleIdentifier: "com.example.app",
        assetFileData: formatStoredFileData(stored),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return row!;
  }

  test("auth: 503 without token, 401 on mismatch", async () => {
    const noTokenApp = createApp({ ...world, config: { ...world.config, apiToken: null } });
    const unavailable = await noTokenApp.request("/api/v1/devices", { headers: auth });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "MDM_API_TOKEN is not configured" });

    const missing = await world.app.request("/api/v1/devices");
    expect(missing.status).toBe(401);
    expect(missing.headers.get("WWW-Authenticate")).toBe("Bearer");
    const wrong = await world.app.request("/api/v1/devices", {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(wrong.status).toBe(401);
  });

  test("devices and ipa listings", async () => {
    await seedDevice("UDID-B", "SERIAL-B");
    await seedDevice("UDID-A", "SERIAL-A");
    const devices = await world.app.request("/api/v1/devices", { headers: auth });
    expect(await devices.json()).toEqual({
      mdm_devices: [
        { udid: "UDID-A", serial_number: "SERIAL-A" },
        { udid: "UDID-B", serial_number: "SERIAL-B" },
      ],
    });

    await seedIpa("b.ipa");
    await seedIpa("a.ipa");
    const list = await world.app.request("/api/v1/ipa", { headers: auth });
    const listJson = (await list.json()) as { ipa_files: Array<{ filename: string }> };
    expect(listJson.ipa_files.map((row) => row.filename)).toEqual(["a.ipa", "b.ipa"]);

    const detail = await world.app.request("/api/v1/ipa/a.ipa", { headers: auth });
    expect(await detail.json()).toMatchObject({
      filename: "a.ipa",
      bundleIdentifier: "com.example.app",
      manifestUrl: "https://mdm.example.com/ipa/a.ipa/manifest",
    });
    const missing = await world.app.request("/api/v1/ipa/nope.ipa", { headers: auth });
    expect(missing.status).toBe(404);
  });

  test("PUT ipa replaces the blob and deletes the old one", async () => {
    const row = await seedIpa("old.ipa");
    const oldKey = JSON.parse(row.assetFileData).id as string;
    const form = new FormData();
    form.set("asset_file", new File(["new-ipa-bytes"], "new.ipa", { type: "application/octet-stream" }));
    form.set("bundle_identifier", "com.example.new");
    const res = await world.app.request("/api/v1/ipa/old.ipa", {
      method: "PUT",
      headers: auth,
      body: form,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      filename: "new.ipa",
      bundleIdentifier: "com.example.new",
    });
    await expect(world.fileStore.readStored({ key: oldKey, storage: "store", metadata: {} })).rejects.toThrow();

    const noFile = await world.app.request("/api/v1/ipa/new.ipa", {
      method: "PUT",
      headers: auth,
      body: new FormData(),
    });
    expect(noFile.status).toBe(400);
  });

  test("install dispatches pushes and reports unknowns", async () => {
    await seedDevice("UDID-1", "SERIAL-1");
    await seedDevice("UDID-2", "SERIAL-2", false);
    await seedIpa("ExampleApp.ipa");

    const res = await world.app.request("/api/v1/ipa/ExampleApp.ipa/install", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ udids: ["UDID-1", "UDID-2", "UDID-3", ""] }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.enqueued).toHaveLength(2);
    expect(json.push_succeeded).toEqual([
      { kind: "mdm", udid: "UDID-1", serial_number: "SERIAL-1" },
    ]);
    expect(json.push_failed).toEqual([
      { kind: "mdm", udid: "UDID-2", serial_number: "SERIAL-2", error: "no push endpoint" },
    ]);
    expect(json.unknown_udids).toEqual(["UDID-3"]);
    expect(world.sentPushes).toEqual([{ token: "token-UDID-1", pushMagic: "magic-UDID-1" }]);

    const invalid = await world.app.request("/api/v1/ipa/ExampleApp.ipa/install", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: "{oops",
    });
    expect(invalid.status).toBe(400);

    const empty = await world.app.request("/api/v1/ipa/ExampleApp.ipa/install", {
      method: "POST",
      headers: auth,
    });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ enqueued: [], unknown_udids: [] });

    const missing = await world.app.request("/api/v1/ipa/nope.ipa/install", {
      method: "POST",
      headers: auth,
    });
    expect(missing.status).toBe(404);
  });
});
