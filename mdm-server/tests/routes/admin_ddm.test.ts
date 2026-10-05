import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  ddmActivationTargets,
  ddmActivations,
  ddmAssetDetails,
  ddmAssets,
  ddmConfigurations,
  ddmDeviceGroupItems,
  ddmDeviceGroups,
  ddmManagementDetails,
  ddmManagements,
  ddmPublicAssetDetails,
  ddmPublicAssets,
  mdmDevices,
} from "../../src/schema";
import { parseStoredFileData } from "../../src/storage/files";
import { truncateAll } from "../db/helpers";
import { adminWorld, loginCookie } from "../helpers/admin";

describe("admin DDM", () => {
  let world: Awaited<ReturnType<typeof adminWorld>>;
  let cookie: string;

  beforeEach(async () => {
    world = await adminWorld();
    await truncateAll(world.db);
    world.sentPushes.length = 0;
    cookie = await loginCookie(world.app);
  });

  const auth = () => ({ Cookie: cookie });
  const formHeaders = () => ({ ...auth(), "Content-Type": "application/x-www-form-urlencoded" });
  const postForm = (path: string, params: Record<string, string>) =>
    world.app.request(path, {
      method: "POST",
      headers: formHeaders(),
      body: new URLSearchParams(params).toString(),
    });

  async function createGroup(name: string, serials: string[]) {
    const now = new Date();
    const [group] = await world.db
      .insert(ddmDeviceGroups)
      .values({ name, createdAt: now, updatedAt: now })
      .returning();
    if (serials.length > 0) {
      await world.db.insert(ddmDeviceGroupItems).values(
        serials.map((serial) => ({
          ddmDeviceGroupId: group!.id,
          deviceIdentifier: serial,
          createdAt: now,
        })),
      );
    }
    return group!;
  }

  test("device groups create, update, rename, and clear", async () => {
    const created = await postForm("/ddm/device_groups", {
      name: "lab",
      serial_numbers: "S1\nS2\n",
    });
    expect(created.status).toBe(302);
    let groups = await world.db.select().from(ddmDeviceGroups);
    expect(groups).toHaveLength(1);

    const show = await world.app.request(`/ddm/device_groups/${groups[0]!.id}`, { headers: auth() });
    const showHtml = await show.text();
    expect(showHtml).toContain("Device group: lab");
    expect(showHtml).toContain("Rename");

    // Add S3, drop S1: both sides of the sync apply.
    const updated = await postForm(`/ddm/device_groups/${groups[0]!.id}`, {
      serial_numbers: "S2\nS3\n",
    });
    expect(updated.status).toBe(302);
    let items = await world.db
      .select()
      .from(ddmDeviceGroupItems)
      .where(eq(ddmDeviceGroupItems.ddmDeviceGroupId, groups[0]!.id));
    expect(items.map((item) => item.deviceIdentifier).sort()).toEqual(["S2", "S3"]);

    // Pure removal without additions is a no-op (Ruby quirk preserved).
    await postForm(`/ddm/device_groups/${groups[0]!.id}`, { serial_numbers: "S2\n" });
    items = await world.db
      .select()
      .from(ddmDeviceGroupItems)
      .where(eq(ddmDeviceGroupItems.ddmDeviceGroupId, groups[0]!.id));
    expect(items.map((item) => item.deviceIdentifier).sort()).toEqual(["S2", "S3"]);

    const renamed = await postForm(`/ddm/device_groups/${groups[0]!.id}/rename`, { name: "lab2" });
    expect(renamed.status).toBe(302);
    groups = await world.db.select().from(ddmDeviceGroups);
    expect(groups[0]!.name).toBe("lab2");
  });

  test("activations create, update targets, and delete", async () => {
    const created = await postForm("/ddm/activations", {
      name: "act1",
      payload: "key: value",
      target_identifiers: "S1\nlab\n",
    });
    expect(created.status).toBe(302);
    const activations = await world.db.select().from(ddmActivations);
    expect(activations).toHaveLength(1);
    expect(activations[0]).toMatchObject({ name: "act1", type: "standard" });
    expect(JSON.parse(activations[0]!.payload)).toEqual({ key: "value" });
    let targets = await world.db.select().from(ddmActivationTargets);
    expect(targets.map((t) => t.targetIdentifier).sort()).toEqual(["S1", "lab"]);

    // Update replaces the payload and syncs targets; name stays untouched.
    const updated = await postForm(`/ddm/activations/${activations[0]!.id}`, {
      name: "ignored",
      payload: "key: value2",
      target_identifiers: "S1\n",
    });
    expect(updated.status).toBe(302);
    const [row] = await world.db
      .select()
      .from(ddmActivations)
      .where(eq(ddmActivations.id, activations[0]!.id));
    expect(row!.name).toBe("act1");
    expect(JSON.parse(row!.payload)).toEqual({ key: "value2" });
    targets = await world.db.select().from(ddmActivationTargets);
    expect(targets.map((t) => t.targetIdentifier)).toEqual(["S1"]);

    const deleted = await postForm(`/ddm/activations/${activations[0]!.id}/delete`, {});
    expect(deleted.status).toBe(302);
    expect(await world.db.select().from(ddmActivations)).toHaveLength(0);
    expect(await world.db.select().from(ddmActivationTargets)).toHaveLength(0);
  });

  test("activations reject blank names and payloads", async () => {
    expect((await postForm("/ddm/activations", { name: "", payload: "a: 1" })).status).toBe(500);
    expect((await postForm("/ddm/activations", { name: "x", payload: "" })).status).toBe(500);
    expect(await world.db.select().from(ddmActivations)).toHaveLength(0);
  });

  test("activation index follows display_sorted order", async () => {
    await createGroup("g1", ["S1"]);
    await world.db.insert(mdmDevices).values({
      udid: "u1",
      serialNumber: "S9",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await postForm("/ddm/activations", { name: "for-unknown", payload: "a: 1", target_identifiers: "ZZZ\n" });
    await postForm("/ddm/activations", { name: "for-s1", payload: "a: 1", target_identifiers: "S1\n" });
    await postForm("/ddm/activations", { name: "for-g1", payload: "a: 1", target_identifiers: "g1\n" });
    // NULL targets sort first; no console flow creates them, so insert directly.
    const [fallback] = await world.db
      .insert(ddmActivations)
      .values({
        name: "for-all",
        type: "standard",
        payload: "{}",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    await world.db.insert(ddmActivationTargets).values({
      ddmActivationId: fallback!.id,
      targetIdentifier: null,
      createdAt: new Date(),
    });

    const index = await world.app.request("/ddm/activations", { headers: auth() });
    const html = await index.text();
    const positions = ["for-all", "for-g1", "for-s1", "for-unknown"].map((name) => html.indexOf(name));
    expect(positions.every((pos) => pos >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  test("configurations create, update (name ignored), and delete", async () => {
    await postForm("/ddm/configurations", {
      name: "cfg1",
      type: "com.apple.test",
      payload: "k: v",
    });
    let rows = await world.db.select().from(ddmConfigurations);
    expect(rows).toHaveLength(1);

    await postForm(`/ddm/configurations/${rows[0]!.id}`, {
      name: "ignored",
      type: "com.apple.test2",
      payload: "k: v2",
    });
    rows = await world.db.select().from(ddmConfigurations);
    expect(rows[0]).toMatchObject({ name: "cfg1", type: "com.apple.test2" });

    await postForm(`/ddm/configurations/${rows[0]!.id}/delete`, {});
    expect(await world.db.select().from(ddmConfigurations)).toHaveLength(0);
  });

  test("assets upsert details per target and list in priority order", async () => {
    await createGroup("g1", ["S1"]);
    await postForm("/ddm/assets", { name: "asset1", type: "com.apple.asset.test" });
    const [asset] = await world.db.select().from(ddmAssets);

    await postForm(`/ddm/assets/${asset!.id}/details`, {
      target_identifier: "S1",
      payload: "v: s1",
    });
    await postForm(`/ddm/assets/${asset!.id}/details`, { target_identifier: "", payload: "v: fb" });
    // Same target again overwrites instead of duplicating.
    await postForm(`/ddm/assets/${asset!.id}/details`, {
      target_identifier: "S1",
      payload: "v: s1b",
    });
    const details = await world.db
      .select()
      .from(ddmAssetDetails)
      .where(eq(ddmAssetDetails.ddmAssetId, asset!.id));
    expect(details).toHaveLength(2);
    expect(details.find((d) => d.targetIdentifier === "S1")?.payload).toBe(
      JSON.stringify({ v: "s1b" }),
    );

    const index = await world.app.request("/ddm/assets", { headers: auth() });
    const html = await index.text();
    // Group members sort before the NULL fallback.
    expect(html.indexOf("[S1]")).toBeLessThan(html.indexOf("[FALLBACK]"));

    const detailPage = await world.app.request(`/ddm/assets/${asset!.id}/details`, {
      headers: auth(),
    });
    expect(await detailPage.text()).toContain("New target");

    await postForm(`/ddm/assets/${asset!.id}/delete`, {});
    expect(await world.db.select().from(ddmAssets)).toHaveLength(0);
    expect(await world.db.select().from(ddmAssetDetails)).toHaveLength(0);
  });

  test("managements share the master/detail flow", async () => {
    await postForm("/ddm/managements", { name: "m1", type: "com.apple.management.properties" });
    const [master] = await world.db.select().from(ddmManagements);
    expect(master!.type).toBe("com.apple.management.properties");
    await postForm(`/ddm/managements/${master!.id}/details`, {
      target_identifier: "",
      payload: "p: 1",
    });
    expect(await world.db.select().from(ddmManagementDetails)).toHaveLength(1);
    const page = await world.app.request(`/ddm/managements/${master!.id}/details`, {
      headers: auth(),
    });
    expect(await page.text()).toContain("Management property: m1");
    await postForm(`/ddm/managements/${master!.id}/delete`, {});
    expect(await world.db.select().from(ddmManagements)).toHaveLength(0);
  });

  test("public assets upload files per target and delete blobs with the asset", async () => {
    await postForm("/ddm/public_assets", { name: "pub1" });
    const [asset] = await world.db.select().from(ddmPublicAssets);

    const upload = new FormData();
    upload.append("target_identifier", "");
    upload.append("asset_file", new File(["public-bytes"], "data.bin"));
    const stored = await world.app.request(`/ddm/public_assets/${asset!.id}/details`, {
      method: "POST",
      headers: auth(),
      body: upload,
    });
    expect(stored.status).toBe(302);
    const details = await world.db
      .select()
      .from(ddmPublicAssetDetails)
      .where(eq(ddmPublicAssetDetails.ddmPublicAssetId, asset!.id));
    expect(details).toHaveLength(1);

    const page = await world.app.request(`/ddm/public_assets/${asset!.id}/details`, {
      headers: auth(),
    });
    const html = await page.text();
    expect(html).toContain("Public assets - pub1");
    expect(html).toContain("/asset_files/store/");

    // The file downloads through the public asset URL.
    const accessMatch = /https:\/\/mdm\.example\.com(\/asset_files\/store\/[a-z0-9/_.-]+)/i.exec(html);
    expect(accessMatch).toBeTruthy();
    const download = await world.app.request(accessMatch![1]!, { headers: auth() });
    expect(await download.text()).toBe("public-bytes");

    await postForm(`/ddm/public_assets/${asset!.id}/delete`, {});
    expect(await world.db.select().from(ddmPublicAssets)).toHaveLength(0);
    await expect(
      world.fileStore.readStored(parseStoredFileData(details[0]!.assetFileData)),
    ).rejects.toThrow();
  });

  test("public asset details delete individually", async () => {
    await postForm("/ddm/public_assets", { name: "pub1" });
    const [asset] = await world.db.select().from(ddmPublicAssets);
    const upload = new FormData();
    upload.append("target_identifier", "S1");
    upload.append("asset_file", new File(["x"], "x.bin"));
    await world.app.request(`/ddm/public_assets/${asset!.id}/details`, {
      method: "POST",
      headers: auth(),
      body: upload,
    });
    const [detail] = await world.db.select().from(ddmPublicAssetDetails);
    const deleted = await postForm(
      `/ddm/public_assets/${asset!.id}/details/${detail!.id}/delete`,
      {},
    );
    expect(deleted.status).toBe(302);
    expect(await world.db.select().from(ddmPublicAssetDetails)).toHaveLength(0);
  });

  test("ddm index summarizes every section", async () => {
    await createGroup("g1", ["S1"]);
    await postForm("/ddm/activations", { name: "act1", payload: "a: 1", target_identifiers: "S1\n" });
    await postForm("/ddm/configurations", { name: "cfg1", type: "t", payload: "c: 1" });
    await postForm("/ddm/assets", { name: "a1", type: "t" });
    await postForm("/ddm/managements", { name: "m1", type: "t" });
    await postForm("/ddm/public_assets", { name: "p1" });
    const index = await world.app.request("/ddm", { headers: auth() });
    const html = await index.text();
    for (const needle of ["Device groups", "Activations", "Configurations", "Assets", "Management properties", "Public assets", "act1", "cfg1"]) {
      expect(html).toContain(needle);
    }
  });

  test("new forms render for groups, activations, and configurations", async () => {
    for (const path of ["/ddm/device_groups/new", "/ddm/activations/new", "/ddm/configurations/new"]) {
      const response = await world.app.request(path, { headers: auth() });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("NEW");
    }
  });

  test("bogus ids fail like ActiveRecord find", async () => {
    expect((await world.app.request("/ddm/device_groups/hoge", { headers: auth() })).status).toBe(500);
    expect((await postForm("/ddm/activations/hoge/delete", {})).status).toBe(500);
  });
});
