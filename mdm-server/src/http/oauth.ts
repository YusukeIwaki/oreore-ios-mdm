import { randomBytes } from "node:crypto";

/**
 * Hand-rolled Google OAuth2 (replaces OmniAuth): authorize redirect, code
 * exchange, userinfo lookup. Endpoints are injectable for tests.
 */
export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  userinfoUrl?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export function authorizeRedirectUrl(
  config: GoogleOAuthConfig,
  baseUrl: string,
  state: string,
): string {
  const url = new URL(config.authorizeUrl ?? DEFAULT_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", `${baseUrl}/auth/google_oauth2/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  return url.toString();
}

export function newState(): string {
  return randomBytes(16).toString("hex");
}

export interface GoogleUserinfo {
  email: string;
  emailVerified: boolean;
}

export async function exchangeCodeForUserinfo(
  config: GoogleOAuthConfig,
  baseUrl: string,
  code: string,
): Promise<GoogleUserinfo> {
  const fetchFn = config.fetchFn ?? fetch;
  const tokenResponse = await fetchFn(config.tokenUrl ?? DEFAULT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: `${baseUrl}/auth/google_oauth2/callback`,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!tokenResponse.ok) {
    throw new Error(`Google token exchange failed: ${tokenResponse.status}`);
  }
  const tokenJson = (await tokenResponse.json()) as { access_token?: unknown };
  if (typeof tokenJson.access_token !== "string") {
    throw new Error("Google token exchange returned no access_token");
  }
  const userinfoResponse = await fetchFn(config.userinfoUrl ?? DEFAULT_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!userinfoResponse.ok) {
    throw new Error(`Google userinfo failed: ${userinfoResponse.status}`);
  }
  const userinfo = (await userinfoResponse.json()) as {
    email?: unknown;
    email_verified?: unknown;
  };
  if (typeof userinfo.email !== "string" || !userinfo.email) {
    throw new Error("Google userinfo returned no email");
  }
  return { email: userinfo.email, emailVerified: userinfo.email_verified === true };
}

/** Callback landing: ignore blank or /auth/ return targets, like the Ruby app. */
export function callbackReturnUrl(returnTo: string | undefined): string {
  if (!returnTo || returnTo.includes("/auth/")) {
    return "/";
  }
  return returnTo;
}
