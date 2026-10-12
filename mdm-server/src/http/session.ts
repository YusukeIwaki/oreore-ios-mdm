import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { Context } from "hono";

/**
 * Signed-cookie session (mirrors Rack cookie sessions: uid + return_to +
 * OAuth state, no server-side storage).
 */
export interface SessionData {
  uid?: string;
  returnTo?: string;
  oauthState?: string;
  csrf?: string;
}

const COOKIE_NAME = "mdm_session";

export async function getSession(
  c: Context,
  secret: string,
): Promise<SessionData> {
  const raw = await getSignedCookie(c, secret, COOKIE_NAME);
  if (!raw || typeof raw !== "string") {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as SessionData;
    }
  } catch {
    // Fall through to an empty session on corrupt cookies.
  }
  return {};
}

export async function setSession(
  c: Context,
  secret: string,
  data: SessionData,
  secure: boolean,
): Promise<void> {
  await setSignedCookie(c, COOKIE_NAME, JSON.stringify(data), secret, {
    httpOnly: true,
    sameSite: "Lax",
    secure,
    path: "/",
    maxAge: 24 * 60 * 60,
  });
}

export function clearSession(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}
