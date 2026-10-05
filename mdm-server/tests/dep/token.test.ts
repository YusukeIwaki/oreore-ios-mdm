import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { decryptDepToken, DepTokenError } from "../../src/dep/token";

/** Requires the `openssl` CLI. Envelopes are encrypted at test time. */
async function sh(args: string[], stdin?: Uint8Array): Promise<string> {
  const proc = Bun.spawn(["openssl", ...args], {
    stdin,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`openssl ${args.join(" ")} failed: ${stderr}`);
  }
  return stdout;
}

describe("DEP server token decryption", () => {
  let dir: string;
  let keyPem: string;
  let certPem: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "dep-token-"));
    await sh(["genrsa", "-out", join(dir, "dep.key"), "2048"]);
    await sh([
      "req", "-new", "-x509", "-key", join(dir, "dep.key"), "-out", join(dir, "dep.crt"),
      "-days", "2", "-subj", "/CN=dep-test",
    ]);
    keyPem = await readFile(join(dir, "dep.key"), "utf8");
    certPem = await readFile(join(dir, "dep.crt"), "utf8");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function encrypt(message: string): Promise<Uint8Array> {
    // `-binary` preserves the message bytes exactly, like Apple's real .p7m
    // (plain `smime -encrypt` would canonicalize newlines to CRLF).
    const out = await sh(
      ["cms", "-encrypt", "-binary", "-in", "/dev/stdin", join(dir, "dep.crt")],
      new TextEncoder().encode(message),
    );
    return new TextEncoder().encode(out);
  }

  test("decrypts a token envelope", async () => {
    const payload = {
      consumer_key: "ck",
      consumer_secret: "cs",
      access_token: "at",
      access_secret: "as",
      access_token_expiry: "2026-05-01T00:00:00Z",
    };
    const message = `-----BEGIN MESSAGE-----\n${JSON.stringify(payload)}\n-----END MESSAGE-----\n`;
    const envelope = await encrypt(message);
    const parsed = await decryptDepToken(envelope, keyPem);
    expect(parsed.rawPayload).toBe(message);
    expect(parsed).toMatchObject({
      consumerKey: "ck",
      consumerSecret: "cs",
      accessToken: "at",
      accessSecret: "as",
    });
    expect(parsed.accessTokenExpiry).toEqual(new Date("2026-05-01T00:00:00Z"));
  });

  test("rejects garbage and incomplete tokens", async () => {
    await expect(decryptDepToken(new TextEncoder().encode("not-smime"), keyPem)).rejects.toBeInstanceOf(
      DepTokenError,
    );
    const envelope = await encrypt("-----BEGIN MESSAGE-----\n{}\n-----END MESSAGE-----\n");
    await expect(decryptDepToken(envelope, keyPem)).rejects.toThrow(/access_token_expiry/);
    const noBlock = await encrypt("plain text without markers");
    await expect(decryptDepToken(noBlock, keyPem)).rejects.toThrow(/BEGIN MESSAGE/);
  });
});
