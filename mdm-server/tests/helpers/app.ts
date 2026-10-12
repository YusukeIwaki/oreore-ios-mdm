import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "../../src/config";
import { createApp } from "../../src/index";
import { FileStore, LocalFileBackend } from "../../src/storage/files";
import { testDb } from "../db/helpers";

export const TEST_TOPIC = "com.apple.mgmt.External.bun-test";

/** Requires the `openssl` CLI for a throwaway push P12. */
async function openssl(args: string[]): Promise<void> {
  const proc = Bun.spawn(["openssl", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`openssl ${args.join(" ")} failed: ${stderr}`);
  }
}

interface TestWorld {
  app: ReturnType<typeof createApp>;
  config: AppConfig;
  db: ReturnType<typeof testDb>;
  fileStore: FileStore;
  sentPushes: Array<{ token: string; pushMagic: string }>;
}

let cached: TestWorld | null = null;

/** Shared app + config + local file store for route tests (DB still per-test). */
export async function testApp(): Promise<TestWorld> {
  if (cached) {
    return cached;
  }
  const dir = await mkdtemp(join(tmpdir(), "bun-app-"));
  await openssl([
    "req", "-newkey", "rsa:2048", "-keyout", join(dir, "push.key"), "-out", join(dir, "push.csr"),
    "-nodes", "-subj", `/UID=${TEST_TOPIC}/CN=APSP:test/C=US`,
  ]);
  await openssl([
    "x509", "-req", "-in", join(dir, "push.csr"), "-signkey", join(dir, "push.key"),
    "-out", join(dir, "push.crt"), "-days", "2",
  ]);
  await openssl([
    "pkcs12", "-export", "-out", join(dir, "push.p12"), "-inkey", join(dir, "push.key"),
    "-in", join(dir, "push.crt"), "-passout", "pass:testpass",
  ]);
  const der = new Uint8Array(await readFile(join(dir, "push.p12")));

  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const uploadDir = await mkdtemp(join(tmpdir(), "bun-uploads-"));
  const config: AppConfig = {
    port: 0,
    baseUrl: "https://mdm.example.com",
    databaseUrl: process.env.TEST_DATABASE_URL ?? "",
    sessionSecret: "test-session-secret",
    secureCookies: false,
    payloadUuid: "payload-uuid-test",
    pushCertificate: { der, password: "testpass" },
    deviceP12Der: new Uint8Array([0x30, 0x01, 0x02]),
    depKeyPem: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    apiToken: "api-token-test",
    google: null,
    allowedDomains: [],
    allowedUsers: [],
    s3: null,
    uploadDir,
  };
  const db = testDb();
  const fileStore = new FileStore(new LocalFileBackend(uploadDir));
  const sentPushes: TestWorld["sentPushes"] = [];
  const app = createApp({
    config,
    db,
    fileStore,
    sendPush: async (endpoint) => {
      sentPushes.push(endpoint);
      return { status: 200 };
    },
  });
  cached = { app, config, db, fileStore, sentPushes };
  return cached;
}
