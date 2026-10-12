import { beforeEach, describe, expect, test } from "bun:test";
import { buildPlist, dataToBuffer, parsePlist } from "../../src/mdm/plist";
import { ipaFiles } from "../../src/schema";
import { formatStoredFileData } from "../../src/storage/files";
import { testApp } from "../helpers/app";
import { truncateAll } from "../db/helpers";

describe("enrollment routes", () => {
  let world: Awaited<ReturnType<typeof testApp>>;

  beforeEach(async () => {
    world = await testApp();
    await truncateAll(world.db);
  });

  test("service discovery endpoints", async () => {
    for (const path of ["/mdm_service_discovery", "/mdm/service_discovery"]) {
      const res = await world.app.request(path);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        Servers: [{ Version: "mdm-byod", BaseURL: "https://mdm.example.com/mdm-byod/enroll" }],
      });
    }
    const res = await world.app.request("/MDMServiceConfig");
    expect(await res.json()).toEqual({
      dep_enrollment_url: "https://mdm.example.com/mdm/dep_enroll",
      dep_anchor_certs_url: "https://mdm.example.com/mdm/dep_anchor_certs",
    });
  });

  test("dep_anchor_certs and appleconfigurator", async () => {
    const certs = await world.app.request("/mdm/dep_anchor_certs");
    expect(await certs.json()).toEqual([]);
    const ok = await world.app.request("/mdm/appleconfigurator");
    expect(await ok.text()).toBe("OK");
  });

  test("mobileconfig endpoints serve the enrollment profile", async () => {
    for (const [method, path] of [
      ["GET", "/mdm.mobileconfig"],
      ["POST", "/mdm.mobileconfig"],
      ["GET", "/mdm/dep_enroll"],
      ["POST", "/mdm/dep_enroll"],
      ["POST", "/mdm/appleconfigurator"],
    ] as const) {
      const res = await world.app.request(path, { method });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/x-apple-aspen-config");
      const payload = parsePlist(await res.text()) as {
        PayloadType: string;
        PayloadUUID: string;
        PayloadContent: Array<{ PayloadType: string; Topic?: string; ServerURL?: string }>;
      };
      expect(payload.PayloadType).toBe("Configuration");
      expect(payload.PayloadUUID).toBe("payload-uuid-test");
      expect(payload.PayloadContent[1]!.PayloadType).toBe("com.apple.mdm");
      expect(payload.PayloadContent[1]!.ServerURL).toBe("https://mdm.example.com/mdm/command");
    }
  });

  test("IPA manifest serves plist metadata", async () => {
    const stored = await world.fileStore.upload({
      bytes: new TextEncoder().encode("fake-ipa"),
      filename: "ExampleApp.ipa",
      contentType: "application/octet-stream",
    });
    await world.db.insert(ipaFiles).values({
      filename: "ExampleApp.ipa",
      bundleIdentifier: "com.example.app",
      assetFileData: formatStoredFileData(stored),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await world.app.request("/ipa/ExampleApp.ipa/manifest");
    expect(res.status).toBe(200);
    const manifest = parsePlist(await res.text()) as {
      items: Array<{
        assets: Array<{ kind: string; url: string }>;
        metadata: Record<string, string>;
      }>;
    };
    expect(manifest.items[0]!.assets[0]!.kind).toBe("software-package");
    expect(manifest.items[0]!.assets[0]!.url).toContain("/asset_files/store/");
    expect(manifest.items[0]!.metadata).toMatchObject({
      "bundle-identifier": "com.example.app",
      kind: "software",
      title: "Download com.example.app",
    });
  });

  test("asset_files serves uploads with adjusted headers", async () => {
    const plistFile = await world.fileStore.upload({
      bytes: new TextEncoder().encode(buildPlist({ a: 1 })),
      filename: "profile.plist",
    });
    const res = await world.app.request(`/asset_files/store/${plistFile.key}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/plist");
    expect(res.headers.get("Content-Disposition")).toBeNull();

    const mobileconfig = await world.fileStore.upload({
      bytes: new TextEncoder().encode("config"),
      filename: "profile.mobileconfig",
    });
    const res2 = await world.app.request(`/asset_files/store/${mobileconfig.key}`);
    expect(res2.headers.get("Content-Type")).toBe("application/x-apple-aspen-config");
    expect(res2.headers.get("Content-Disposition")).toContain('filename="profile.mobileconfig"');

    const missing = await world.app.request("/asset_files/store/nope/missing.bin");
    expect(missing.status).toBe(404);
  });
});
