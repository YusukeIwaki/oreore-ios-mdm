import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./context";
import { getSession, setSession } from "./session";

/** Admin console access rules (ported from `SimpleAdminConsole` helpers). */
export function loginAllowed(
  email: string,
  options: { allowedDomains: string[]; allowedUsers: string[] },
): boolean {
  // NOTE: no trimming, exactly like the Ruby split(',').include? checks.
  if (options.allowedDomains.length > 0) {
    if (options.allowedDomains.includes(email.split("@").at(-1) ?? "")) {
      return true;
    }
  }
  if (options.allowedUsers.length > 0) {
    if (options.allowedUsers.includes(email)) {
      return true;
    }
  }
  return false;
}

/**
 * Only page navigations are worth coming back to after login. Sub-resource
 * requests the browser fires on its own (favicon, images, source maps) carry
 * an Accept header without text/html; remembering those as `returnTo` would
 * overwrite the page the user actually asked for.
 */
export function capturesReturnTo(method: string, accept: string | undefined): boolean {
  if (method !== "GET") {
    return false;
  }
  return (accept ?? "").split(",").some((part) => part.trim().split(";")[0] === "text/html");
}

/**
 * Sinatra's `login_required`, called as the first statement of every admin
 * console handler. Unauthenticated requests are bounced to the login page
 * (via HTTPException, like Sinatra's `halt`), remembering page navigations as
 * `returnTo`. Doing this per handler rather than via `app.use()` keeps
 * unmatched paths such as `/favicon.ico` as plain 404s that never touch the
 * session.
 */
export async function loginRequired(c: Context<AppEnv>): Promise<void> {
  const config = c.get("config");
  const session = await getSession(c, config.sessionSecret);
  if (session.uid) {
    return;
  }
  if (capturesReturnTo(c.req.method, c.req.header("accept"))) {
    const query = new URL(c.req.url).search;
    await setSession(
      c,
      config.sessionSecret,
      { ...session, returnTo: `${c.req.path}${query}` },
      config.secureCookies,
    );
  }
  throw new HTTPException(302, { res: c.redirect("/") });
}
