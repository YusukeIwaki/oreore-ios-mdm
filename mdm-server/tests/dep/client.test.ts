import { afterEach, describe, expect, test } from "bun:test";
import { DepClient, DepError } from "../../src/dep/client";

const CREDENTIALS = {
  consumerKey: "ck",
  consumerSecret: "cs",
  accessToken: "at",
  accessSecret: "as",
};

describe("DepClient", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;

  afterEach(() => {
    server?.stop(true);
    server = null;
  });

  function stub(handler: (req: Request) => Response | Promise<Response>): string {
    server = Bun.serve({ port: 0, fetch: handler });
    return `http://localhost:${server.port}`;
  }

  test("fetches a session token with an OAuth header", async () => {
    let authorization: string | null = null;
    const baseUrl = stub((req) => {
      const url = new URL(req.url);
      if (url.pathname === "/session") {
        authorization = req.headers.get("Authorization");
        return Response.json({ auth_session_token: "session-1" });
      }
      return new Response("nope", { status: 404 });
    });
    const client = new DepClient(CREDENTIALS, { baseUrl, retryDelayMs: 0 });
    await expect(client.fetchSessionToken()).resolves.toBe("session-1");
    expect(authorization).toMatch(/^OAuth oauth_consumer_key="ck", .*realm="ADM"$/);
  });

  test("CRUD sends exact headers and parses JSON", async () => {
    const seen: Array<{ method: string; path: string; headers: Record<string, string>; body: string }> = [];
    const baseUrl = stub(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/session") {
        return Response.json({ auth_session_token: "session-1" });
      }
      seen.push({
        method: req.method,
        path: url.pathname,
        headers: Object.fromEntries(req.headers.entries()),
        body: await req.text(),
      });
      return Response.json({ ok: true });
    });
    const client = new DepClient(CREDENTIALS, { baseUrl, retryDelayMs: 0 });
    await client.get("account");
    await client.post("devices", { devices: ["S1"] });
    await client.put("profile", { a: 1 });
    await client.delete("profile/devices", { profile_uuid: "p", devices: ["S1"] });
    await client.delete("account-driven-enrollment/profile");

    expect(seen.map((entry) => [entry.method, entry.path])).toEqual([
      ["GET", "/account"],
      ["POST", "/devices"],
      ["PUT", "/profile"],
      ["DELETE", "/profile/devices"],
      ["DELETE", "/account-driven-enrollment/profile"],
    ]);
    for (const entry of seen) {
      expect(entry.headers["x-adm-auth-session"]).toBe("session-1");
      expect(entry.headers["x-server-protocol-version"]).toBe("3");
    }
    expect(seen[1]!.body).toBe(JSON.stringify({ devices: ["S1"] }));
    expect(seen[1]!.headers["content-type"]).toContain("application/json;charset=UTF8");
    expect(seen[3]!.body).toBe(JSON.stringify({ profile_uuid: "p", devices: ["S1"] }));
    expect(seen[4]!.body).toBe("null");
  });

  test("retries 401s with a refreshed token, then raises", async () => {
    let calls = 0;
    const baseUrl = stub((req) => {
      const url = new URL(req.url);
      if (url.pathname === "/session") {
        calls += 1;
        return Response.json({ auth_session_token: `session-${calls}` });
      }
      return req.headers.get("X-ADM-Auth-Session") === "session-2"
        ? Response.json({ recovered: true })
        : new Response("expired", { status: 401 });
    });
    const client = new DepClient(CREDENTIALS, { baseUrl, retryDelayMs: 0 });
    await expect(client.get("account")).resolves.toEqual({ recovered: true });
    expect(calls).toBe(2);

    const failing = stub((req) =>
      new URL(req.url).pathname === "/session"
        ? Response.json({ auth_session_token: "s" })
        : new Response("denied", { status: 403 }),
    );
    await expect(new DepClient(CREDENTIALS, { baseUrl: failing, retryDelayMs: 0 }).get("account")).rejects.toBeInstanceOf(
      DepError,
    );
  });
});
