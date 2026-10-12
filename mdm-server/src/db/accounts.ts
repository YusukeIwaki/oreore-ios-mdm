import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db";
import {
  managedAppleAccountAccessTokenUsages,
  managedAppleAccountAccessTokens,
  managedAppleAccounts,
} from "../schema";

/** Managed Apple Accounts + access tokens (ported from the MAA models). */
export type AccountRow = typeof managedAppleAccounts.$inferSelect;
export type AccessTokenRow = typeof managedAppleAccountAccessTokens.$inferSelect;

export class RecordNotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordNotFound";
  }
}

export class TokenUsageConflict extends Error {
  constructor() {
    super("Access token is already used by another device");
    this.name = "TokenUsageConflict";
  }
}

export async function findAccountByEmail(db: Database, email: string): Promise<AccountRow> {
  const [row] = await db
    .select()
    .from(managedAppleAccounts)
    .where(eq(managedAppleAccounts.email, email))
    .limit(1);
  if (!row) {
    throw new RecordNotFound(`no ManagedAppleAccount with email ${email}`);
  }
  return row;
}

export async function findAccountById(db: Database, id: number): Promise<AccountRow> {
  const [row] = await db
    .select()
    .from(managedAppleAccounts)
    .where(eq(managedAppleAccounts.id, id))
    .limit(1);
  if (!row) {
    throw new RecordNotFound(`no ManagedAppleAccount with id ${id}`);
  }
  return row;
}

export async function createAccessToken(
  db: Database,
  accountId: number,
  options: { token?: string; expiresAt?: Date } = {},
): Promise<AccessTokenRow> {
  const now = new Date();
  const [row] = await db
    .insert(managedAppleAccountAccessTokens)
    .values({
      managedAppleAccountId: accountId,
      token: options.token ?? randomBytes(24).toString("hex"),
      expiresAt: options.expiresAt ?? new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row!;
}

export async function findAccessToken(
  db: Database,
  tokenValue: string,
): Promise<AccessTokenRow | null> {
  const [row] = await db
    .select()
    .from(managedAppleAccountAccessTokens)
    .where(eq(managedAppleAccountAccessTokens.token, tokenValue))
    .limit(1);
  return row ?? null;
}

export function isExpired(token: AccessTokenRow, now: Date = new Date()): boolean {
  return token.expiresAt.getTime() <= now.getTime();
}

export async function findTokenUsage(
  db: Database,
  tokenId: number,
  deviceIdentifier: string,
): Promise<typeof managedAppleAccountAccessTokenUsages.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(managedAppleAccountAccessTokenUsages)
    .where(
      and(
        eq(
          managedAppleAccountAccessTokenUsages.managedAppleAccountAccessTokenId,
          tokenId,
        ),
        eq(managedAppleAccountAccessTokenUsages.deviceIdentifier, deviceIdentifier),
      ),
    )
    .limit(1);
  return row ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth++) {
    if ((current as { code?: unknown }).code === "23505") {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Bind a token to a device (insert or rebind), mapping conflicts to 400s. */
export async function recordTokenUsage(
  db: Database,
  tokenId: number,
  deviceIdentifier: string,
): Promise<void> {
  try {
    const [existing] = await db
      .select()
      .from(managedAppleAccountAccessTokenUsages)
      .where(eq(managedAppleAccountAccessTokenUsages.deviceIdentifier, deviceIdentifier))
      .limit(1);
    if (existing) {
      await db
        .update(managedAppleAccountAccessTokenUsages)
        .set({ managedAppleAccountAccessTokenId: tokenId })
        .where(eq(managedAppleAccountAccessTokenUsages.id, existing.id));
    } else {
      await db.insert(managedAppleAccountAccessTokenUsages).values({
        managedAppleAccountAccessTokenId: tokenId,
        deviceIdentifier,
      });
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new TokenUsageConflict();
    }
    throw error;
  }
}
