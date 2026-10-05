import type { AppConfig } from "../../src/config";
import { createApp } from "../../src/index";
import type { AppVariables } from "../../src/http/context";
import { testApp } from "./app";

export interface AdminOverrides {
  config?: Partial<AppConfig>;
  depClientFor?: AppVariables["depClientFor"];
  vppClientFor?: AppVariables["vppClientFor"];
  googleOAuth?: AppVariables["googleOAuth"];
}

/** App with an admin allow-list (plus optional Apple/OAuth stubs). */
export async function adminWorld(overrides: AdminOverrides = {}) {
  const world = await testApp();
  const app = createApp({
    config: { ...world.config, allowedUsers: ["admin@example.com"], ...overrides.config },
    db: world.db,
    fileStore: world.fileStore,
    sendPush: async (endpoint) => {
      world.sentPushes.push(endpoint);
      return { status: 200 };
    },
    ...(overrides.depClientFor ? { depClientFor: overrides.depClientFor } : {}),
    ...(overrides.vppClientFor ? { vppClientFor: overrides.vppClientFor } : {}),
    ...(overrides.googleOAuth ? { googleOAuth: overrides.googleOAuth } : {}),
  });
  return { ...world, app };
}

function cookieValue(response: Response, name: string): string | null {
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
  for (const entry of setCookies) {
    const [pair] = entry.split(";");
    const [key, ...rest] = (pair ?? "").split("=");
    if (key === name) {
      return rest.join("=");
    }
  }
  return null;
}

function csrfToken(html: string): string {
  const match = /name="authenticity_token" value="([^"]*)"/.exec(html);
  if (!match) {
    throw new Error("no authenticity_token in response");
  }
  return match[1]!;
}

function withCookie(cookie: string | null): Record<string, string> {
  return cookie ? { Cookie: `mdm_session=${cookie}` } : {};
}

/** Full debug-login flow; returns a `Cookie` header value for admin requests. */
export async function loginCookie(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: { request: (...args: any[]) => Response | Promise<Response> },
  email = "admin@example.com",
): Promise<string> {
  const landing = await app.request("/");
  const landingHtml = await landing.text();
  let cookie = cookieValue(landing, "mdm_session");
  const csrf = csrfToken(landingHtml);

  const formResponse = await app.request("/auth/developer", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...withCookie(cookie) },
    body: new URLSearchParams({ authenticity_token: csrf }).toString(),
  });
  if (formResponse.status !== 200) {
    throw new Error(`developer form failed: ${formResponse.status}`);
  }
  cookie = cookieValue(formResponse, "mdm_session") ?? cookie;

  const callback = await app.request("/auth/developer/callback", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...withCookie(cookie) },
    body: new URLSearchParams({ authenticity_token: csrf, email }).toString(),
  });
  if (callback.status !== 302) {
    throw new Error(`developer callback failed: ${callback.status} ${await callback.text()}`);
  }
  const session = cookieValue(callback, "mdm_session");
  if (!session) {
    throw new Error("no session cookie after login");
  }
  return `mdm_session=${session}`;
}
