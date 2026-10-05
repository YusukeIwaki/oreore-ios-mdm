import { randomBytes, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../http/context";
import { loginAllowed } from "../http/adminAuth";
import { getSession, setSession } from "../http/session";
import {
  authorizeRedirectUrl,
  callbackReturnUrl,
  exchangeCodeForUserinfo,
  newState,
} from "../http/oauth";
import { DeveloperLoginPage, LoginPage } from "../views/admin/login";

/**
 * Admin console entry + authentication. Google OAuth is hand-rolled here
 * (replacing OmniAuth); the debug login renders its own email form.
 */
export const authRoutes = new Hono<AppEnv>();

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

authRoutes.get("/", async (c) => {
  const config = c.get("config");
  const session = await getSession(c, config.sessionSecret);
  if (session.uid) {
    return c.redirect("/devices");
  }
  const csrf = session.csrf ?? randomBytes(16).toString("hex");
  if (!session.csrf) {
    await setSession(c, config.sessionSecret, { ...session, csrf }, config.secureCookies);
  }
  return c.html(LoginPage({ googleConfigured: config.google !== null, csrfToken: csrf }));
});

async function verifyCsrf(c: Context<AppEnv>): Promise<boolean> {
  const body = await c.req.parseBody();
  const token = body.authenticity_token;
  if (typeof token !== "string") {
    return false;
  }
  const session = await getSession(c, c.get("config").sessionSecret);
  return typeof session.csrf === "string" && safeEqual(session.csrf, token);
}

authRoutes.post("/auth/developer", async (c) => {
  const config = c.get("config");
  if (!(await verifyCsrf(c))) {
    return c.text("invalid authenticity token", 403);
  }
  const session = await getSession(c, config.sessionSecret);
  return c.html(DeveloperLoginPage({ csrfToken: session.csrf ?? "" }));
});

authRoutes.post("/auth/developer/callback", async (c) => {
  const config = c.get("config");
  if (!(await verifyCsrf(c))) {
    return c.text("invalid authenticity token", 403);
  }
  const body = await c.req.parseBody();
  const email = typeof body.email === "string" ? body.email : "";
  const session = await getSession(c, config.sessionSecret);
  const returnUrl = callbackReturnUrl(session.returnTo);
  if (email !== "" && loginAllowed(email, config)) {
    await setSession(c, config.sessionSecret, { csrf: session.csrf, uid: email }, config.secureCookies);
    return c.redirect(returnUrl);
  }
  return c.text("Access Forbidden", 403);
});

authRoutes.post("/auth/google_oauth2", async (c) => {
  const config = c.get("config");
  if (!config.google) {
    return c.text("Google login is not configured", 404);
  }
  if (!(await verifyCsrf(c))) {
    return c.text("invalid authenticity token", 403);
  }
  const session = await getSession(c, config.sessionSecret);
  const state = newState();
  await setSession(
    c,
    config.sessionSecret,
    { ...session, oauthState: state },
    config.secureCookies,
  );
  const hooks = c.get("googleOAuth");
  return c.redirect(
    authorizeRedirectUrl(
      { clientId: config.google.clientId, clientSecret: config.google.clientSecret, ...hooks },
      config.baseUrl,
      state,
    ),
  );
});

authRoutes.get("/auth/google_oauth2/callback", async (c) => {
  const config = c.get("config");
  if (!config.google) {
    return c.text("Google login is not configured", 404);
  }
  const session = await getSession(c, config.sessionSecret);
  const state = c.req.query("state") ?? "";
  if (!session.oauthState || !safeEqual(session.oauthState, state)) {
    return c.text("invalid OAuth state", 403);
  }
  const code = c.req.query("code") ?? "";
  const returnUrl = callbackReturnUrl(session.returnTo);
  const hooks = c.get("googleOAuth");
  try {
    const userinfo = await exchangeCodeForUserinfo(
      { clientId: config.google.clientId, clientSecret: config.google.clientSecret, ...hooks },
      config.baseUrl,
      code,
    );
    if (userinfo.emailVerified && loginAllowed(userinfo.email, config)) {
      await setSession(
        c,
        config.sessionSecret,
        { csrf: session.csrf, uid: userinfo.email },
        config.secureCookies,
      );
      return c.redirect(returnUrl);
    }
  } catch (error) {
    console.error(`google oauth callback failed: ${(error as Error).message}`);
  }
  return c.text("Access Forbidden", 403);
});
