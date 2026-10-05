import { afterEach, describe, expect, test } from "bun:test";
import { VppClient, VppError } from "../../src/vpp/client";

describe("VppClient", () => {
  let servers: Array<ReturnType<typeof Bun.serve>> = [];

  afterEach(() => {
    for (const server of servers) {
      server.stop(true);
    }
    servers = [];
  });

  function stub(handler: (req: Request) => Response | Promise<Response>): string {
    const server = Bun.serve({ port: 0, fetch: handler });
    servers.push(server);
    return `http://localhost:${server.port}`;
  }

  test("get/post send Bearer auth and parse JSON", async () => {
    const seen: Array<{ auth: string | null; body: string }> = [];
    const baseUrl = stub(async (req) => {
      seen.push({ auth: req.headers.get("Authorization"), body: await req.text() });
      return Response.json({ ok: true });
    });
    const client = new VppClient("s-token", { baseUrl });
    await expect(client.get("assets")).resolves.toEqual({ ok: true });
    await expect(client.post("assets/associate", { a: 1 })).resolves.toEqual({ ok: true });
    expect(seen[0]).toMatchObject({ auth: "Bearer s-token", body: "" });
    expect(seen[1]).toMatchObject({ auth: "Bearer s-token", body: '{"a":1}' });
  });

  test("fetchAppInformation queries the lookup service", async () => {
    let query = "";
    const lookupBaseUrl = stub((req) => {
      const url = new URL(req.url);
      query = url.searchParams.toString();
      expect(url.pathname).toBe("/WebObjects/MZStorePlatform.woa/wa/lookup");
      return Response.json({ results: { "12345": { name: "Example App" } } });
    });
    const client = new VppClient("s-token", { baseUrl: "http://localhost:1", lookupBaseUrl });
    await expect(client.fetchAppInformation("12345")).resolves.toEqual({ name: "Example App" });
    const params = new URLSearchParams(query);
    expect(Object.fromEntries(params.entries())).toEqual({
      id: "12345",
      version: "2",
      p: "mdm-lockup",
      caller: "MDM",
      platform: "enterprisestore",
      cc: "jp",
      l: "ja",
    });
  });

  test("raises on HTTP errors", async () => {
    const baseUrl = stub(() => new Response("nope", { status: 500 }));
    await expect(new VppClient("s-token", { baseUrl }).get("assets")).rejects.toBeInstanceOf(
      VppError,
    );
  });
});
