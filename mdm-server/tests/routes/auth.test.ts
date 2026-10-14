import { beforeEach, describe, expect, test } from "bun:test";
import { truncateAll } from "../db/helpers";
import { adminWorld, loginCookie } from "../helpers/admin";
import { adminRoutes } from "../../src/routes/admin";
import { adminDdmRoutes } from "../../src/routes/adminDdm";

describe("admin auth", () => {
  let world: Awaited<ReturnType<typeof adminWorld>>;

  beforeEach(async () => {
    world = await adminWorld();
    await truncateAll(world.db);
    world.sentPushes.length = 0;
  });

  function csrfFrom(html: string): string {
    const match = /name="authenticity_token" value="([^"]*)"/.exec(html);
    return match![1]!;
  }

  function sessionFrom(response: Response): string | null {
    for (const entry of response.headers.getSetCookie()) {
      const [pair] = entry.split(";");
      const [key, ...rest] = (pair ?? "").split("=");
      if (key === "mdm_session") {
        return rest.join("=");
      }
    }
    return null;
  }

  test("GET / shows the debug login when Google is unconfigured", async () => {
    const response = await world.app.request("/");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('action="/auth/developer"');
    expect(html).toContain("Login for debug");
    expect(sessionFrom(response)).toBeTruthy();
  });

  test("GET / shows the Google login when configured", async () => {
    const google = await adminWorld({
      config: { google: { clientId: "cid", clientSecret: "csecret" } },
    });
    const response = await google.app.request("/");
    const html = await response.text();
    expect(html).toContain('action="/auth/google_oauth2"');
    expect(html).toContain("Login with Google");
  });

  test("GET / redirects to /devices once logged in", async () => {
    const cookie = await loginCookie(world.app);
    const response = await world.app.request("/", { headers: { Cookie: cookie } });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/devices");
  });

  test("login_required redirects to / and captures return_to", async () => {
    const response = await world.app.request("/devices/abc?x=1", {
      headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    const cookie = sessionFrom(response);
    expect(cookie).toBeTruthy();

    // Complete the login with the captured session: lands back on the page.
    const landing = await world.app.request("/", {
      headers: { Cookie: `mdm_session=${cookie}` },
    });
    const csrf = csrfFrom(await landing.text());
    const headers = {
      Cookie: `mdm_session=${sessionFrom(landing) ?? cookie}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    await world.app.request("/auth/developer", {
      method: "POST",
      headers,
      body: new URLSearchParams({ authenticity_token: csrf }).toString(),
    });
    const callback = await world.app.request("/auth/developer/callback", {
      method: "POST",
      headers,
      body: new URLSearchParams({ authenticity_token: csrf, email: "admin@example.com" }).toString(),
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/devices/abc?x=1");
  });

  test("every admin console route calls loginRequired", async () => {
    const routes = [...adminRoutes.routes, ...adminDdmRoutes.routes];
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      const path = route.path.replace(/:[a-z_]+/g, "x");
      const response = await world.app.request(path, {
        method: route.method,
        headers: { Accept: "text/html" },
      });
      expect(`${route.method} ${route.path} -> ${response.status}`).toBe(
        `${route.method} ${route.path} -> 302`,
      );
      expect(response.headers.get("location")).toBe("/");
    }
  });

  test("unmatched paths such as /favicon.ico 404 without touching the session", async () => {
    const response = await world.app.request("/favicon.ico", {
      headers: { Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
    });
    expect(response.status).toBe(404);
    expect(sessionFrom(response)).toBeNull();
  });

  test("sub-resource requests do not overwrite return_to", async () => {
    const page = await world.app.request("/devices/abc", {
      headers: { Accept: "text/html,*/*;q=0.8" },
    });
    const cookie = sessionFrom(page)!;

    // A browser-initiated sub-resource fetch of a protected route (favicon,
    // prefetch, image): still bounced to the login page, but it must not
    // replace the page we came from.
    const image = await world.app.request("/devices", {
      headers: { Cookie: `mdm_session=${cookie}`, Accept: "image/avif,image/webp,*/*;q=0.8" },
    });
    expect(image.status).toBe(302);
    expect(sessionFrom(image)).toBeNull();

    const landing = await world.app.request("/", {
      headers: { Cookie: `mdm_session=${cookie}` },
    });
    const csrf = csrfFrom(await landing.text());
    const headers = {
      Cookie: `mdm_session=${sessionFrom(landing) ?? cookie}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    const callback = await world.app.request("/auth/developer/callback", {
      method: "POST",
      headers,
      body: new URLSearchParams({ authenticity_token: csrf, email: "admin@example.com" }).toString(),
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/devices/abc");
  });

  test("POST /auth/developer rejects a bad authenticity token", async () => {
    const response = await world.app.request("/auth/developer", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ authenticity_token: "bogus" }).toString(),
    });
    expect(response.status).toBe(403);
  });

  test("developer callback rejects disallowed emails with 403", async () => {
    const landing = await world.app.request("/");
    const csrf = csrfFrom(await landing.text());
    const cookie = sessionFrom(landing);
    const headers = {
      Cookie: `mdm_session=${cookie}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    await world.app.request("/auth/developer", {
      method: "POST",
      headers,
      body: new URLSearchParams({ authenticity_token: csrf }).toString(),
    });
    const callback = await world.app.request("/auth/developer/callback", {
      method: "POST",
      headers,
      body: new URLSearchParams({ authenticity_token: csrf, email: "intruder@example.com" }).toString(),
    });
    expect(callback.status).toBe(403);
    expect(await callback.text()).toBe("Access Forbidden");
  });

  test("Google flow redirects out and logs in on callback", async () => {
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("token")) {
        return Response.json({ access_token: "at-1" });
      }
      expect(init?.headers).toMatchObject({ Authorization: "Bearer at-1" });
      return Response.json({ email: "admin@example.com", email_verified: true });
    }) as typeof fetch;
    const google = await adminWorld({
      config: { google: { clientId: "cid", clientSecret: "csecret" } },
      googleOAuth: {
        authorizeUrl: "https://accounts.example.com/auth",
        tokenUrl: "https://accounts.example.com/token",
        userinfoUrl: "https://accounts.example.com/userinfo",
        fetchFn,
      },
    });
    const landing = await google.app.request("/");
    const csrf = csrfFrom(await landing.text());
    const cookie = sessionFrom(landing);
    const headers = {
      Cookie: `mdm_session=${cookie}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    const redirect = await google.app.request("/auth/google_oauth2", {
      method: "POST",
      headers,
      body: new URLSearchParams({ authenticity_token: csrf }).toString(),
    });
    expect(redirect.status).toBe(302);
    const target = new URL(redirect.headers.get("location")!);
    expect(target.origin + target.pathname).toBe("https://accounts.example.com/auth");
    const state = target.searchParams.get("state")!;
    expect(state).toBeTruthy();

    const authed = await google.app.request(
      `/auth/google_oauth2/callback?state=${state}&code=code-1`,
      { headers: { Cookie: `mdm_session=${sessionFrom(redirect) ?? cookie}` } },
    );
    expect(authed.status).toBe(302);
    expect(authed.headers.get("location")).toBe("/");
    expect(sessionFrom(authed)).toBeTruthy();
  });

  test("Google callback rejects bad state and unverified emails", async () => {
    const fetchFn = (async (url: string | URL | Request) =>
      String(url).includes("token")
        ? Response.json({ access_token: "at-1" })
        : Response.json({ email: "admin@example.com", email_verified: false })) as typeof fetch;
    const google = await adminWorld({
      config: { google: { clientId: "cid", clientSecret: "csecret" } },
      googleOAuth: {
        tokenUrl: "https://accounts.example.com/token",
        userinfoUrl: "https://accounts.example.com/userinfo",
        fetchFn,
      },
    });
    const landing = await google.app.request("/");
    const csrf = csrfFrom(await landing.text());
    const cookie = sessionFrom(landing);
    const headers = {
      Cookie: `mdm_session=${cookie}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    const redirect = await google.app.request("/auth/google_oauth2", {
      method: "POST",
      headers,
      body: new URLSearchParams({ authenticity_token: csrf }).toString(),
    });
    const session = sessionFrom(redirect) ?? cookie;

    const badState = await google.app.request(
      "/auth/google_oauth2/callback?state=wrong&code=code-1",
      { headers: { Cookie: `mdm_session=${session}` } },
    );
    expect(badState.status).toBe(403);

    const state = new URL(redirect.headers.get("location")!).searchParams.get("state")!;
    const unverified = await google.app.request(
      `/auth/google_oauth2/callback?state=${state}&code=code-1`,
      { headers: { Cookie: `mdm_session=${session}` } },
    );
    expect(unverified.status).toBe(403);
  });
});
