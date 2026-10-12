import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  byodDevices,
  byodPushEndpoints,
  ddmSynchronizationRequestHistories,
  ipaFiles,
  mdmCommandHistories,
  mdmCommandRequests,
  mdmDevices,
  mdmPushEndpoints,
  rtsWifiProfiles,
} from "../../src/schema";
import { formatStoredFileData } from "../../src/storage/files";
import { truncateAll } from "../db/helpers";
import { adminWorld, loginCookie } from "../helpers/admin";
import { renderedBox } from "../helpers/browser";

describe("admin devices", () => {
  let world: Awaited<ReturnType<typeof adminWorld>>;
  let cookie: string;

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

  beforeEach(async () => {
    world = await adminWorld();
    await truncateAll(world.db);
    world.sentPushes.length = 0;
    cookie = await loginCookie(world.app);
  });

  const auth = () => ({ Cookie: cookie });

  test("index lists MDM + BYOD devices and the enrollment QR", async () => {
    await seedDevice("udid-1", "SERIAL1");
    await world.db
      .insert(byodDevices)
      .values({ enrollmentId: "enroll-1", createdAt: new Date() });

    const response = await world.app.request("/devices", { headers: auth() });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("/devices/udid-1");
    expect(html).toContain("SERIAL1");
    expect(html).toContain("/byod/devices/enroll-1");
    expect(html).toContain("<svg");

    // The enrollment QR must render small: a bare viewBox-only SVG stretches
    // to the container width, so assert the actual rendered box, not markup.
    const box = await renderedBox({
      fetch: (req) => world.app.fetch(req),
      cookie,
      path: "/devices",
      selector: "svg",
    });
    expect(box.width).toBeCloseTo(120, 0);
    expect(box.height).toBeCloseTo(120, 0);
  });

  test("show renders the queue, histories, and sync list", async () => {
    await seedDevice("udid-1", "SERIAL1");
    await world.db.insert(mdmCommandRequests).values({
      deviceIdentifier: "udid-1",
      requestPayload: "<plist>request</plist>",
      createdAt: new Date(),
    });
    await world.db.insert(mdmCommandHistories).values({
      deviceIdentifier: "udid-1",
      requestType: "DeviceInformation",
      commandUuid: "uuid-1",
      requestPayload: "<plist>req</plist>",
      responsePayload: "<plist>res</plist>",
      createdAt: new Date(),
    });
    await world.db.insert(ddmSynchronizationRequestHistories).values({
      deviceIdentifier: "udid-1",
      endpoint: "declaration-items",
      requestPayload: "{}",
      responsePayload: "{}",
      createdAt: new Date(),
    });

    const response = await world.app.request("/devices/udid-1", { headers: auth() });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Device - SERIAL1");
    expect(html).toContain("/commands/uuid-1");
    expect(html).toContain("declaration-items");
    expect(html).toContain('action="/devices/udid-1/push"');
  });

  test("commands enqueue plist and skip blank payloads", async () => {
    await seedDevice("udid-1", "SERIAL1");
    const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CommandUUID</key><string>u1</string></dict></plist>`;

    const enqueued = await world.app.request("/devices/udid-1/commands", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ payload: plist }).toString(),
    });
    expect(enqueued.status).toBe(302);
    const rows = await world.db
      .select()
      .from(mdmCommandRequests)
      .where(eq(mdmCommandRequests.deviceIdentifier, "udid-1"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.requestPayload).toContain("u1");

    const blank = await world.app.request("/devices/udid-1/commands", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ payload: "   " }).toString(),
    });
    expect(blank.status).toBe(302);
    const still = await world.db
      .select()
      .from(mdmCommandRequests)
      .where(eq(mdmCommandRequests.deviceIdentifier, "udid-1"));
    expect(still).toHaveLength(1);
  });

  test("commands on an unknown device fail like find_by!", async () => {
    const response = await world.app.request("/devices/nope/commands", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ payload: "x" }).toString(),
    });
    expect(response.status).toBe(500);
  });

  test("form_inner renders templates per command", async () => {
    await seedDevice("udid-1", "SERIAL1");

    const info = await world.app.request(
      "/devices/udid-1/command_request_form_inner?command=DeviceInformation",
      { headers: auth() },
    );
    expect(info.status).toBe(200);
    const infoHtml = await info.text();
    expect(infoHtml).not.toContain("<html");
    expect(infoHtml).toContain("turbo-frame");
    expect(infoHtml).toContain("DeviceInformation");
    expect(infoHtml).toContain("IsNetworkTethered");

    const install = await world.app.request(
      "/devices/udid-1/command_request_form_inner?command=InstallProfile",
      { headers: auth() },
    );
    const installHtml = await install.text();
    expect(installHtml).toContain("data-install-profile-drop");
    expect(installHtml).toContain("/install_profile_payload");

    const unknown = await world.app.request(
      "/devices/udid-1/command_request_form_inner?command=Bogus",
      { headers: auth() },
    );
    const unknownHtml = await unknown.text();
    expect(unknownHtml).toContain('name="payload"');
    expect(unknownHtml).not.toContain("RequestType");
  });

  test("form_inner InstallApplication uses the selected IPA manifest", async () => {
    await seedDevice("udid-1", "SERIAL1");
    const stored = await world.fileStore.upload({
      bytes: new TextEncoder().encode("ipa"),
      filename: "App One.ipa",
      contentType: "application/octet-stream",
    });
    const [ipa] = await world.db
      .insert(ipaFiles)
      .values({
        filename: "App One.ipa",
        bundleIdentifier: "com.example.app",
        assetFileData: formatStoredFileData(stored),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const response = await world.app.request(
      `/devices/udid-1/command_request_form_inner?command=InstallApplication&ipa_file_id=${ipa!.id}`,
      { headers: auth() },
    );
    const html = await response.text();
    expect(html).toContain("InstallApplication");
    expect(html).toContain("/ipa/App%20One.ipa/manifest");
    expect(html).toContain("App One.ipa");
  });

  test("form_inner EraseDevice falls back without RTS profiles", async () => {
    await seedDevice("udid-1", "SERIAL1");
    const response = await world.app.request(
      "/devices/udid-1/command_request_form_inner?command=EraseDevice",
      { headers: auth() },
    );
    const html = await response.text();
    expect(html).toContain("EraseDevice");
    expect(html).toContain("PreserveDataPlan");
    expect(html).not.toContain("ReturnToService");
  });

  test("form_inner EraseDevice embeds RTS wifi + mdm profile data", async () => {
    await seedDevice("udid-1", "SERIAL1");
    const stored = await world.fileStore.upload({
      bytes: new TextEncoder().encode("wifi-profile-bytes"),
      filename: "wifi.mobileconfig",
    });
    await world.db.insert(rtsWifiProfiles).values({
      name: "office-wifi",
      assetFileData: formatStoredFileData(stored),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const response = await world.app.request(
      "/devices/udid-1/command_request_form_inner?command=EraseDevice",
      { headers: auth() },
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("ReturnToService");
    expect(html).toContain("WiFiProfileData");
    expect(html).toContain("MDMProfileData");
  });

  test("form_inner DeclarativeManagement carries sync tokens", async () => {
    await seedDevice("udid-1", "SERIAL1");
    const response = await world.app.request(
      "/devices/udid-1/command_request_form_inner?command=DeclarativeManagement",
      { headers: auth() },
    );
    const html = await response.text();
    expect(html).toContain("DeclarativeManagement");
    // Sync tokens travel as a base64 <data> blob, like the Ruby command.
    expect(html).toContain("&lt;data&gt;");
  });

  test("install_profile_payload requires a file and returns InstallProfile plist", async () => {
    const missing = await world.app.request("/install_profile_payload", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(missing.status).toBe(400);

    const form = new FormData();
    form.append("mobileconfig_file", new File(["<plist>profile</plist>"], "a.mobileconfig"));
    const built = await world.app.request("/install_profile_payload", {
      method: "POST",
      headers: auth(),
      body: form,
    });
    expect(built.status).toBe(200);
    expect(built.headers.get("content-type")).toBe("application/xml");
    const xml = await built.text();
    expect(xml).toContain("InstallProfile");
    expect(xml.endsWith("\n")).toBe(false);
  });

  test("push notifies the endpoint and redirects", async () => {
    await seedDevice("udid-1", "SERIAL1");
    const response = await world.app.request("/devices/udid-1/push", {
      method: "POST",
      headers: auth(),
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/devices/udid-1");
    expect(world.sentPushes).toEqual([{ token: "token-udid-1", pushMagic: "magic-udid-1" }]);
  });

  test("push without an endpoint fails", async () => {
    await seedDevice("udid-1", "SERIAL1", false);
    const response = await world.app.request("/devices/udid-1/push", {
      method: "POST",
      headers: auth(),
    });
    expect(response.status).toBe(500);
  });

  test("command history page shows request and response payloads", async () => {
    await world.db.insert(mdmCommandHistories).values({
      deviceIdentifier: "udid-1",
      requestType: "ProfileList",
      commandUuid: "uuid-9",
      requestPayload: "<plist>REQ</plist>",
      responsePayload: "<plist>RES</plist>",
      createdAt: new Date(),
    });
    const response = await world.app.request("/commands/uuid-9", { headers: auth() });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("&lt;plist&gt;REQ&lt;/plist&gt;");
    expect(html).toContain("&lt;plist&gt;RES&lt;/plist&gt;");
  });

  test("sync history page scopes rows to the device", async () => {
    await seedDevice("udid-1", "SERIAL1");
    const [row] = await world.db
      .insert(ddmSynchronizationRequestHistories)
      .values({
        deviceIdentifier: "udid-1",
        endpoint: "declaration-items",
        requestPayload: '{"a":1}',
        responsePayload: '{"b":2}',
        createdAt: new Date(),
      })
      .returning();
    const response = await world.app.request(
      `/devices/udid-1/synchronization_request_histories/${row!.id}`,
      { headers: auth() },
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("declaration-items");
    expect(html).toContain("&quot;a&quot;");
  });

  test("BYOD show, commands, form, and push", async () => {
    const [device] = await world.db
      .insert(byodDevices)
      .values({ enrollmentId: "enroll-1", createdAt: new Date() })
      .returning();
    await world.db.insert(byodPushEndpoints).values({
      byodDeviceId: device!.id,
      token: "byod-token",
      pushMagic: "byod-magic",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const show = await world.app.request("/byod/devices/enroll-1", { headers: auth() });
    expect(show.status).toBe(200);
    expect(await show.text()).toContain("Device - enroll-1");

    const form = await world.app.request(
      "/byod/devices/enroll-1/command_request_form_inner?command=ProfileList",
      { headers: auth() },
    );
    expect(await form.text()).toContain("ProfileList");

    const plist = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CommandUUID</key><string>b1</string></dict></plist>`;
    const enqueued = await world.app.request("/byod/devices/enroll-1/commands", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ payload: plist }).toString(),
    });
    expect(enqueued.status).toBe(302);
    const rows = await world.db
      .select()
      .from(mdmCommandRequests)
      .where(eq(mdmCommandRequests.deviceIdentifier, "enroll-1"));
    expect(rows).toHaveLength(1);

    const pushed = await world.app.request("/byod/devices/enroll-1/push", {
      method: "POST",
      headers: auth(),
    });
    expect(pushed.status).toBe(302);
    expect(world.sentPushes).toEqual([{ token: "byod-token", pushMagic: "byod-magic" }]);
  });
});
