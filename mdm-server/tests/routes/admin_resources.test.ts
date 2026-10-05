import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  ipaFiles,
  mdmCommandRequests,
  mdmDevices,
  mdmPushEndpoints,
  rtsWifiProfiles,
  vppContentTokens,
} from "../../src/schema";
import { formatStoredFileData, parseStoredFileData } from "../../src/storage/files";
import { truncateAll } from "../db/helpers";
import { adminWorld, loginCookie } from "../helpers/admin";

function vppTokenFile(expDate = "2027-01-01T00:00:00Z"): File {
  const ctoken = Buffer.from(JSON.stringify({ expDate })).toString("base64");
  return new File([ctoken], "org.vpptoken");
}

describe("admin RTS/VPP/IPA", () => {
  let world: Awaited<ReturnType<typeof adminWorld>>;
  let cookie: string;

  const vppCalls: Array<{ method: string; path: string; params?: unknown; body?: unknown }> = [];
  const stubVpp = () => ({
    get: async (path: string, params?: Record<string, string>) => {
      vppCalls.push({ method: "GET", path, params });
      if (path === "assets") {
        return { assets: [{ adamId: "aaa", assignedCount: 1, supportedPlatforms: ["iOS"] }] };
      }
      return { assignments: [{ adamId: "aaa", serialNumber: "S1" }], currentPageIndex: 0, totalPages: 1 };
    },
    post: async (path: string, body?: unknown) => {
      vppCalls.push({ method: "POST", path, body });
      return { eventId: "event-1" };
    },
    fetchAppInformation: async (adamId: string | number) => {
      vppCalls.push({ method: "APP", path: String(adamId) });
      return { name: "Example App", adamId: String(adamId) };
    },
  });

  beforeEach(async () => {
    world = await adminWorld({ vppClientFor: stubVpp });
    await truncateAll(world.db);
    world.sentPushes.length = 0;
    vppCalls.length = 0;
    cookie = await loginCookie(world.app);
  });

  const auth = () => ({ Cookie: cookie });

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

  test("RTS profiles upload, upsert by name, show, and delete blobs", async () => {
    const upload = (name: string, content: string) => {
      const form = new FormData();
      form.append("name", name);
      form.append("asset_file", new File([content], "wifi.mobileconfig"));
      return world.app.request("/rts/wifi_profiles", {
        method: "POST",
        headers: auth(),
        body: form,
      });
    };

    expect((await upload("office", "profile-v1")).status).toBe(302);
    expect((await upload("office", "profile-v2")).status).toBe(302);
    const rows = await world.db.select().from(rtsWifiProfiles);
    expect(rows).toHaveLength(1);

    const show = await world.app.request(`/rts/wifi_profiles/${rows[0]!.id}`, { headers: auth() });
    expect(await show.text()).toContain("profile-v2");

    const deleted = await world.app.request(`/rts/wifi_profiles/${rows[0]!.id}/delete`, {
      method: "POST",
      headers: auth(),
    });
    expect(deleted.status).toBe(302);
    expect(await world.db.select().from(rtsWifiProfiles)).toHaveLength(0);
    // Shrine parity: the blob goes away with the row.
    const stored = parseStoredFileData(rows[0]!.assetFileData);
    await expect(world.fileStore.readStored(stored)).rejects.toThrow();
  });

  test("VPP tokens upload and list", async () => {
    const form = new FormData();
    form.append("vpptoken_file", vppTokenFile());
    const response = await world.app.request("/vpp", {
      method: "POST",
      headers: auth(),
      body: form,
    });
    expect(response.status).toBe(302);
    const rows = await world.db.select().from(vppContentTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.filename).toBe("org.vpptoken");
    expect(rows[0]!.expDate).toEqual(new Date("2027-01-01T00:00:00Z"));

    const index = await world.app.request("/vpp", { headers: auth() });
    expect(await index.text()).toContain("org.vpptoken");
  });

  test("VPP show and assignments render stubbed Apple data", async () => {
    const form = new FormData();
    form.append("vpptoken_file", vppTokenFile());
    await world.app.request("/vpp", { method: "POST", headers: auth(), body: form });

    const show = await world.app.request("/vpp/org.vpptoken", { headers: auth() });
    expect(show.status).toBe(200);
    const showHtml = await show.text();
    expect(showHtml).toContain("aaa");
    expect(showHtml).toContain("assignedCount");
    expect(vppCalls[0]).toMatchObject({ method: "GET", path: "assets" });

    const assignments = await world.app.request("/vpp/org.vpptoken/aaa", { headers: auth() });
    const assignmentsHtml = await assignments.text();
    expect(assignmentsHtml).toContain("Example App");
    expect(assignmentsHtml).toContain("S1");
    expect(assignmentsHtml).toContain("/vpp/org.vpptoken/aaa/assignments");
  });

  test("VPP license assignment posts and redirects", async () => {
    const form = new FormData();
    form.append("vpptoken_file", vppTokenFile());
    await world.app.request("/vpp", { method: "POST", headers: auth(), body: form });

    const assigned = await world.app.request("/vpp/org.vpptoken/aaa/assignments", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ serial_number: "SN9" }).toString(),
    });
    expect(assigned.status).toBe(302);
    expect(assigned.headers.get("location")).toBe("/vpp/org.vpptoken/aaa");
    expect(vppCalls).toContainEqual({
      method: "POST",
      path: "assets/associate",
      body: { assets: [{ adamId: "aaa" }], serialNumbers: ["SN9"] },
    });

    // The GET twin redirects to the assignments page.
    const twin = await world.app.request("/vpp/org.vpptoken/aaa/assignments", { headers: auth() });
    expect(twin.status).toBe(302);
    expect(twin.headers.get("location")).toBe("/vpp/org.vpptoken/aaa");
  });

  test("IPA create, show, update, and delete", async () => {
    const create = new FormData();
    create.append("bundle_identifier", "com.example.app");
    create.append("asset_file", new File(["ipa-v1"], "App.ipa"));
    expect((await world.app.request("/ipa", { method: "POST", headers: auth(), body: create })).status).toBe(302);

    let rows = await world.db.select().from(ipaFiles);
    expect(rows).toHaveLength(1);
    const oldData = rows[0]!.assetFileData;

    const show = await world.app.request("/ipa/App.ipa", { headers: auth() });
    const showHtml = await show.text();
    expect(showHtml).toContain("com.example.app");
    expect(showHtml).toContain("/ipa/App.ipa/manifest");
    expect(showHtml).toContain("software-package");

    const update = new FormData();
    update.append("bundle_identifier", "com.example.app2");
    update.append("asset_file", new File(["ipa-v2"], "App2.ipa"));
    const updated = await world.app.request(`/ipa/${rows[0]!.id}/update`, {
      method: "POST",
      headers: auth(),
      body: update,
    });
    expect(updated.status).toBe(302);
    expect(updated.headers.get("location")).toBe("/ipa/App2.ipa");
    rows = await world.db.select().from(ipaFiles);
    expect(rows[0]!.bundleIdentifier).toBe("com.example.app2");
    // Replacing the file deletes the old blob.
    await expect(world.fileStore.readStored(parseStoredFileData(oldData))).rejects.toThrow();

    const deleted = await world.app.request(`/ipa/${rows[0]!.id}/delete`, {
      method: "POST",
      headers: auth(),
    });
    expect(deleted.status).toBe(302);
    expect(await world.db.select().from(ipaFiles)).toHaveLength(0);
  });

  test("IPA install enqueues per device and pushes", async () => {
    await seedDevice("udid-1", "S1");
    await seedDevice("udid-2", "S2", false);
    const stored = await world.fileStore.upload({
      bytes: new TextEncoder().encode("ipa"),
      filename: "App.ipa",
    });
    const [ipa] = await world.db
      .insert(ipaFiles)
      .values({
        filename: "App.ipa",
        bundleIdentifier: "com.example.app",
        assetFileData: formatStoredFileData(stored),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const body = new URLSearchParams();
    body.append("device_identifiers[]", "udid-1");
    body.append("device_identifiers[]", "udid-2");
    body.append("device_identifiers[]", "");
    const installed = await world.app.request(`/ipa/${ipa!.id}/install`, {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(installed.status).toBe(200);
    const html = await installed.text();
    expect(html).toContain("Install dispatched.");
    expect(html).toContain("Push failed: 1");

    const queued = await world.db.select().from(mdmCommandRequests);
    expect(queued).toHaveLength(2);
    expect(world.sentPushes).toEqual([{ token: "token-udid-1", pushMagic: "magic-udid-1" }]);
  });
});
