import type { Context } from "hono";
import type { Database } from "../db";
import {
  findAccessToken,
  findAccountById,
  isExpired,
  type AccessTokenRow,
  type AccountRow,
} from "../db/accounts";

/** Bearer [REDACTED] from the Authorization header (may be expired). */
export async function currentAccessToken(
  db: Database,
  c: Context,
): Promise<AccessTokenRow | null> {
  const match = /^Bearer (.+)$/.exec(c.req.header("Authorization") ?? "");
  if (!match) {
    return null;
  }
  return await findAccessToken(db, match[1]!);
}

export async function authorizedAccount(
  db: Database,
  c: Context,
): Promise<AccountRow | null> {
  const token = await currentAccessToken(db, c);
  if (!token || isExpired(token)) {
    return null;
  }
  return await findAccountById(db, token.managedAppleAccountId);
}

/** `401 Bearer [REDACTED]"apple-as-web", url=".../authenticate"` challenge. */
export function bearerChallenge(baseUrl: string, authenticatePath: string): Response {
  const realm = `method="apple-as-web", url="${baseUrl}${authenticatePath}"`;
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": `Bearer ${realm}` },
  });
}
