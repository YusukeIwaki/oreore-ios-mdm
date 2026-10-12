import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { depServerTokens } from "../../src/schema";
import { DepError } from "../../src/dep/client";
import { truncateAll } from "../db/helpers";
import { adminWorld, loginCookie } from "../helpers/admin";

async function sh(args: string[], stdin?: Uint8Array): Promise<string> {
  const proc = Bun.spawn(["openssl", ...args], { stdin, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`openssl ${args.join(" ")} failed: ${stderr}`);
  }
  return stdout;
}

describe("admin DEP", () => {
  let world: Awaited<ReturnType<typeof adminWorld>>;
  let cookie: string;
  let dir: string;
  let depKeyPem: string;

  const depCalls: Array<{ method: string; path: string; params?: unknown; body?: unknown }> = [];
  let failWith: DepError | null = null;
  let addeProfile: Record<string, unknown> = {};
  const stubDep = () => ({
    get: async (path: string, params?: Record<string, string>) => {
      depCalls.push({ method: "GET", path, params });
      if (failWith) {
        throw failWith;
      }
      if (path === "account") {
        return { serverUuid: "server-1", serverName: "Test" };
      }
      if (path === "os-beta-enrollment/tokens") {
        return { betaEnrollmentTokens: [{ title: "Beta", os: "iOS", token: "tok-1" }] };
      }
      if (path === "account-driven-enrollment/profile") {
        return addeProfile;
      }
      return { profile_uuid: "profile-1", profile_name: "P" };
    },
    post: async (path: string, body?: unknown) => {
      depCalls.push({ method: "POST", path, body });
      if (path === "devices") {
        return { devices: { S1: { serial_number: "S1", profile_uuid: "profile-1" } } };
      }
      if (path === "server/devices") {
        return {
          devices: [{ serial_number: "S2", model: "iPhone" }],
          fetched_until: "2026-01-01",
          more_to_follow: false,
          cursor: "c",
        };
      }
      if (path === "profile") {
        return { devices: { S9: {} }, profile_uuid: "profile-9" };
      }
      return { profile_uuid: "profile-1" };
    },
    put: async (path: string, body?: unknown) => {
      depCalls.push({ method: "PUT", path, body });
      return {};
    },
    delete: async (path: string, body?: unknown) => {
      depCalls.push({ method: "DELETE", path, body });
      return {};
    },
  });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "dep-admin-"));
    await sh(["genrsa", "-out", join(dir, "dep.key"), "2048"]);
    await sh([
      "req", "-new", "-x509", "-key", join(dir, "dep.key"), "-out", join(dir, "dep.crt"),
      "-days", "2", "-subj", "/CN=dep-test",
    ]);
    depKeyPem = await readFile(join(dir, "dep.key"), "utf8");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    world = await adminWorld({
      config: { depKeyPem },
      depClientFor: stubDep,
    });
    await truncateAll(world.db);
    world.sentPushes.length = 0;
    depCalls.length = 0;
    failWith = null;
    addeProfile = {};
    cookie = await loginCookie(world.app);
  });

  const auth = () => ({ Cookie: cookie });

  async function encryptToken(payload: Record<string, string>): Promise<Uint8Array> {
    const message = `-----BEGIN MESSAGE-----\n${JSON.stringify(payload)}\n-----END MESSAGE-----\n`;
    const out = await sh(
      ["cms", "-encrypt", "-binary", "-in", "/dev/stdin", join(dir, "dep.crt")],
      new TextEncoder().encode(message),
    );
    return new TextEncoder().encode(out);
  }

  async function uploadDepToken(filename = "dep.p7m"): Promise<void> {
    const envelope = await encryptToken({
      consumer_key: "ck",
      consumer_secret: "cs",
      access_token: "at",
      access_secret: "as",
      access_token_expiry: "2027-05-01T00:00:00Z",
    });
    const form = new FormData();
    form.append("dep_token_file", new File([envelope as BlobPart], filename));
    const response = await world.app.request("/dep", {
      method: "POST",
      headers: auth(),
      body: form,
    });
    expect(response.status).toBe(200);
  }

  test("token upload decrypts, stores, and lists", async () => {
    await uploadDepToken();
    const rows = await world.db.select().from(depServerTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      filename: "dep.p7m",
      consumerKey: "ck",
      accessToken: "at",
    });
    expect(rows[0]!.rawPayload).toContain("consumer_key");

    const index = await world.app.request("/dep", { headers: auth() });
    const html = await index.text();
    expect(html).toContain("dep.p7m");
    expect(html).toContain("/dep/pub_key.pem");
  });

  test("pub_key.pem serves a verifiable DEP certificate", async () => {
    const response = await world.app.request("/dep/pub_key.pem", { headers: auth() });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-pem-file");
    expect(response.headers.get("content-disposition")).toContain('filename="pub_key.pem"');
    const pem = await response.text();
    expect(pem).toContain("-----BEGIN CERTIFICATE-----");
    const proc = Bun.spawn(["openssl", "x509", "-noout", "-subject"], {
      stdin: new TextEncoder().encode(pem),
      stdout: "pipe",
      stderr: "pipe",
    });
    const subject = await new Response(proc.stdout).text();
    expect(subject.replace(/\s/g, "")).toContain("CN=oreore-mdmDEP");
  });

  test("account page renders live data and rescues errors", async () => {
    await uploadDepToken();
    const ok = await world.app.request("/dep/dep.p7m/account", { headers: auth() });
    expect(await ok.text()).toContain("server-1");

    failWith = new DepError(401, "bad session");
    const failed = await world.app.request("/dep/dep.p7m/account", { headers: auth() });
    const failedHtml = await failed.text();
    expect(failedHtml).toContain("DEP request failed with status 401");
    expect(failedHtml).toContain("bad session");
  });

  test("beta tokens page lists tokens", async () => {
    await uploadDepToken();
    const response = await world.app.request("/dep/dep.p7m/os_beta_enrollment_tokens", {
      headers: auth(),
    });
    const html = await response.text();
    expect(html).toContain("Beta");
    expect(html).toContain("tok-1");
  });

  test("ADDE profile get tolerates missing profiles; post sets, blank deletes", async () => {
    await uploadDepToken();
    const empty = await world.app.request("/dep/dep.p7m/account_driven_enrollment_profile", {
      headers: auth(),
    });
    expect(empty.status).toBe(200);

    addeProfile = {
      mdm_service_discovery_url: "https://mdm.example.com/mdm_service_discovery",
      last_updated_timestamp: "2026-01-02",
    };
    const filled = await world.app.request("/dep/dep.p7m/account_driven_enrollment_profile", {
      headers: auth(),
    });
    const filledHtml = await filled.text();
    expect(filledHtml).toContain("last_updated_timestamp: 2026-01-02");

    const set = await world.app.request("/dep/dep.p7m/account_driven_enrollment_profile", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ url: "https://other.example/discovery" }).toString(),
    });
    expect(set.status).toBe(302);
    expect(depCalls).toContainEqual({
      method: "POST",
      path: "account-driven-enrollment/profile",
      body: { mdm_service_discovery_url: "https://other.example/discovery" },
    });

    const cleared = await world.app.request("/dep/dep.p7m/account_driven_enrollment_profile", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ url: "" }).toString(),
    });
    expect(cleared.status).toBe(302);
    expect(depCalls).toContainEqual({
      method: "DELETE",
      path: "account-driven-enrollment/profile",
      body: undefined,
    });
  });

  test("devices list and single-device lookup", async () => {
    await uploadDepToken();
    const list = await world.app.request("/dep/dep.p7m/devices", { headers: auth() });
    const listHtml = await list.text();
    expect(listHtml).toContain("S2");
    expect(listHtml).toContain("Results until 2026-01-01 are listed.");

    const single = await world.app.request("/dep/dep.p7m/devices/S1", { headers: auth() });
    const singleHtml = await single.text();
    expect(singleHtml).toContain("profile-1");
    expect(singleHtml).toContain("remove_profile");
  });

  test("remove_profile detaches then redirects", async () => {
    await uploadDepToken();
    const response = await world.app.request("/dep/dep.p7m/devices/S1/remove_profile", {
      headers: auth(),
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/dep/dep.p7m/devices/S1");
    expect(depCalls).toContainEqual({
      method: "DELETE",
      path: "profile/devices",
      body: { profile_uuid: "profile-1", devices: ["S1"] },
    });
  });

  test("profile new form, detail, create, and assign", async () => {
    await uploadDepToken();
    const form = await world.app.request("/dep/dep.p7m/profiles/new?serial_number=S5", {
      headers: auth(),
    });
    const formHtml = await form.text();
    expect(formHtml).toContain("- S5");
    expect(formHtml).toContain("/mdm/dep_enroll");

    const detail = await world.app.request("/dep/dep.p7m/profiles/profile-1", { headers: auth() });
    expect(await detail.text()).toContain("profile-1");
    expect(depCalls).toContainEqual({
      method: "GET",
      path: "profile",
      params: { profile_uuid: "profile-1" },
    });

    const created = await world.app.request("/dep/dep.p7m/profiles", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ payload: "profile_name: P\ndevices:\n  - S9\n" }).toString(),
    });
    expect(created.status).toBe(302);
    expect(created.headers.get("location")).toBe("/dep/dep.p7m/devices/S9");

    const assigned = await world.app.request("/dep/dep.p7m/profiles/profile-1/assign", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ serial_numbers: "A1\nB2\n\n" }).toString(),
    });
    expect(assigned.status).toBe(302);
    expect(depCalls).toContainEqual({
      method: "POST",
      path: "profile/devices",
      body: { profile_uuid: "profile-1", devices: ["A1", "B2"] },
    });
  });

  test("DEP show page requires a known token", async () => {
    const missing = await world.app.request("/dep/nope.p7m", { headers: auth() });
    expect(missing.status).toBe(500);
    await uploadDepToken();
    const show = await world.app.request("/dep/dep.p7m", { headers: auth() });
    const html = await show.text();
    expect(html).toContain("Devices");
    expect(html).toContain("Setup profile");
  });

  test("token rows are found by filename", async () => {
    await uploadDepToken("second.p7m");
    const rows = await world.db
      .select()
      .from(depServerTokens)
      .where(eq(depServerTokens.filename, "second.p7m"));
    expect(rows).toHaveLength(1);
  });
});
