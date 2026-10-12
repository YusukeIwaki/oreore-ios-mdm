import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildDepPublicKeyPem } from "../../src/dep/pubkey";

/** Requires the `openssl` CLI. The cert is verified independently of node-forge. */
async function sh(args: string[]): Promise<string> {
  const proc = Bun.spawn(["openssl", ...args], { stdout: "pipe", stderr: "pipe" });
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

describe("DEP public key certificate", () => {
  let dir: string;
  let keyPem: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "dep-pubkey-"));
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    keyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("builds a self-signed CN=oreore-mdm DEP cert with serial 0", async () => {
    const now = new Date();
    const pem = buildDepPublicKeyPem(keyPem, now);
    expect(pem).toContain("-----BEGIN CERTIFICATE-----");
    const certPath = join(dir, "pub.pem");
    await writeFile(certPath, pem);

    const subject = await sh(["x509", "-in", certPath, "-noout", "-subject"]);
    expect(subject.replace(/\s/g, "")).toContain("CN=oreore-mdmDEP");
    const serial = await sh(["x509", "-in", certPath, "-noout", "-serial"]);
    expect(Number.parseInt(serial.trim().replace("serial=", ""), 16)).toBe(0);
    const issuer = await sh(["x509", "-in", certPath, "-noout", "-issuer"]);
    expect(issuer.replace(/\s/g, "")).toContain("CN=oreore-mdmDEP");

    const dates = await sh(["x509", "-in", certPath, "-noout", "-dates"]);
    const notAfter = /notAfter=(.*)/.exec(dates)?.[1];
    expect(notAfter).toBeTruthy();
    const expiry = new Date(notAfter!);
    const days = (expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(364);
    expect(days).toBeLessThan(366);

    // Self-signed: the cert verifies against itself.
    const verify = await sh(["verify", "-CAfile", certPath, certPath]);
    expect(verify).toContain("OK");
  });
});
