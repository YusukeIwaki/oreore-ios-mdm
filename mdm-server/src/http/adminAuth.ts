import { createMiddleware } from "hono/factory";
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

export function loginRequired() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const config = c.get("config");
    const session = await getSession(c, config.sessionSecret);
    if (!session.uid) {
      const query = new URL(c.req.url).search;
      await setSession(
        c,
        config.sessionSecret,
        { ...session, returnTo: `${c.req.path}${query}` },
        config.secureCookies,
      );
      return c.redirect("/");
    }
    await next();
  });
}
