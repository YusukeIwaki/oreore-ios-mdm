import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * DEP `.p7m` server-token decryption (pure part of `DepServerToken.update_from`).
 * S/MIME enveloped-data decryption has no portable JS API, so the system
 * `openssl` CLI is used — an infrequent admin operation, like the Ruby side.
 */
export interface ParsedDepToken {
  rawPayload: string;
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessSecret: string;
  accessTokenExpiry: Date;
}

export class DepTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepTokenError";
  }
}

function extractMessage(decrypted: string): string {
  const match = /-----BEGIN MESSAGE-----\n(.*)\n-----END MESSAGE-----/s.exec(decrypted);
  if (!match) {
    throw new DepTokenError("decrypted token has no -----BEGIN MESSAGE----- block");
  }
  return match[1]!;
}

/** Decrypt S/MIME bytes with an RSA private key (PEM text) via `openssl smime`. */
export async function smimeDecrypt(p7m: Uint8Array, privateKeyPem: string): Promise<string> {
  const openssl = Bun.which("openssl");
  if (!openssl) {
    throw new DepTokenError("openssl CLI is required to decrypt DEP tokens");
  }
  const dir = await mkdtemp(join(tmpdir(), "dep-key-"));
  const keyPath = join(dir, "dep.key");
  try {
    await writeFile(keyPath, privateKeyPem, { mode: 0o600 });
    await chmod(keyPath, 0o600);
    const proc = Bun.spawn([openssl, "smime", "-decrypt", "-inkey", keyPath], {
      stdin: p7m,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new DepTokenError(`openssl smime -decrypt failed: ${stderr.trim().slice(0, 300)}`);
    }
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function requiredField(record: Record<string, unknown>, name: string): string {
  const value = record[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new DepTokenError(`DEP token has no ${name}`);
  }
  return value;
}

export async function decryptDepToken(
  p7m: Uint8Array,
  privateKeyPem: string,
): Promise<ParsedDepToken> {
  const decrypted = await smimeDecrypt(p7m, privateKeyPem);
  const rawPayload = extractMessage(decrypted);
  const parsed: unknown = JSON.parse(rawPayload);
  if (!parsed || typeof parsed !== "object") {
    throw new DepTokenError("DEP token message is not a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const expiryRaw = requiredField(record, "access_token_expiry");
  const accessTokenExpiry = new Date(expiryRaw);
  if (Number.isNaN(accessTokenExpiry.getTime())) {
    throw new DepTokenError(`DEP token has an invalid access_token_expiry: ${expiryRaw}`);
  }
  return {
    rawPayload: decrypted,
    consumerKey: requiredField(record, "consumer_key"),
    consumerSecret: requiredField(record, "consumer_secret"),
    accessToken: requiredField(record, "access_token"),
    accessSecret: requiredField(record, "access_secret"),
    accessTokenExpiry,
  };
}
