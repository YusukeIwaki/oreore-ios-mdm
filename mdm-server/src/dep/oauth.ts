import { createHmac, randomBytes } from "node:crypto";

/**
 * Apple DEP OAuth 1.0a session signing (pure part of `DepClient::AuthSession`).
 */

export interface DepCredentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessSecret: string;
}

export const DEP_SESSION_URL = "https://mdmenrollment.apple.com/session";

/** Exact API headers, including the spaceless `application/json;charset=UTF8`. */
export function depApiHeaders(authSessionToken: string): Record<string, string> {
  return {
    "X-ADM-Auth-Session": authSessionToken,
    "X-Server-Protocol-Version": "3",
    "Content-Type": "application/json;charset=UTF8",
  };
}

export function buildAuthorizationHeader(
  credentials: DepCredentials,
  options: { nonce?: string; timestamp?: string } = {},
): string {
  const nonce = options.nonce ?? randomBytes(16).toString("hex");
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000).toString();
  const params: Array<[string, string]> = [
    ["oauth_consumer_key", credentials.consumerKey],
    ["oauth_token", credentials.accessToken],
    ["oauth_signature_method", "HMAC-SHA1"],
    ["oauth_timestamp", timestamp],
    ["oauth_nonce", nonce],
    ["oauth_version", "1.0"],
  ];
  const sorted = [...params].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const baseString = [
    "GET",
    encodeURIComponent(DEP_SESSION_URL),
    encodeURIComponent(sorted.map(([key, value]) => `${key}=${value}`).join("&")),
  ].join("&");
  // Secrets are joined raw, without per-part encoding, like the Ruby client.
  const key = `${credentials.consumerSecret}&${credentials.accessSecret}`;
  const signature = encodeURIComponent(
    createHmac("sha1", key).update(baseString, "utf8").digest("base64").replace(/\s+/g, ""),
  );
  const headerParams: Array<[string, string]> = [
    ...params,
    ["oauth_signature", signature],
    ["realm", "ADM"],
  ];
  return `OAuth ${headerParams.map(([key, value]) => `${key}="${value}"`).join(", ")}`;
}
