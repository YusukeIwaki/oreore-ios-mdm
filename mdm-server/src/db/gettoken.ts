import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../db";
import { getTokenHistories, getTokenTargets } from "../schema";
import { mintGetToken } from "../dep/jwt";

/** GetToken issuance (ported from `GetTokenGenerator#find_or_generate`). */
export async function firstGetTokenTarget(db: Database) {
  const [row] = await db.select().from(getTokenTargets).limit(1);
  return row ?? null;
}

export async function findOrGenerateGetToken(
  db: Database,
  options: {
    serverUuid: string;
    deviceIdentifier: string;
    serviceType: string;
    depKeyPem: string;
    now?: Date;
    jti?: string;
  },
): Promise<string> {
  const [existing] = await db
    .select()
    .from(getTokenHistories)
    .where(
      and(
        eq(getTokenHistories.deviceIdentifier, options.deviceIdentifier),
        eq(getTokenHistories.serviceType, options.serviceType),
      ),
    )
    .orderBy(desc(getTokenHistories.iat))
    .limit(1);
  if (existing?.jwt) {
    return existing.jwt;
  }

  const iat = options.now ?? new Date();
  const jti = options.jti ?? randomUUID();
  const token = await mintGetToken(options.depKeyPem, {
    service_type: options.serviceType,
    iss: options.serverUuid,
    iat: Math.floor(iat.getTime() / 1000),
    jti,
  });
  await db.insert(getTokenHistories).values({
    deviceIdentifier: options.deviceIdentifier,
    serviceType: options.serviceType,
    iat,
    jti,
    jwt: token,
  });
  return token;
}
