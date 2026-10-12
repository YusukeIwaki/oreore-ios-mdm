import http2 from "node:http2";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { parsePushCertificate, sendMdmNotification } from "../../src/mdm/push";

/** Requires the `openssl` CLI (also required in production for DEP tokens). */
async function sh(...args: string[]): Promise<string> {
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

describe("push", () => {
  let dir: string;
  let p12Der: Uint8Array;
  let caCrt: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "push-test-"));
    await sh("req", "-x509", "-newkey", "rsa:2048", "-keyout", join(dir, "ca.key"), "-out", join(dir, "ca.crt"), "-days", "2", "-nodes", "-subj", "/CN=test-ca");
    await sh("req", "-newkey", "rsa:2048", "-keyout", join(dir, "server.key"), "-out", join(dir, "server.csr"), "-nodes", "-subj", "/CN=localhost");
    await writeFile(join(dir, "san.ext"), "subjectAltName=DNS:localhost\n");
    await sh("x509", "-req", "-in", join(dir, "server.csr"), "-CA", join(dir, "ca.crt"), "-CAkey", join(dir, "ca.key"), "-CAcreateserial", "-out", join(dir, "server.crt"), "-days", "2", "-extfile", join(dir, "san.ext"));
    await sh("req", "-newkey", "rsa:2048", "-keyout", join(dir, "push.key"), "-out", join(dir, "push.csr"), "-nodes", "-subj", "/UID=com.apple.mgmt.External.test-topic/CN=APSP:test/C=US");
    await sh("x509", "-req", "-in", join(dir, "push.csr"), "-CA", join(dir, "ca.crt"), "-CAkey", join(dir, "ca.key"), "-CAcreateserial", "-out", join(dir, "push.crt"), "-days", "2");
    await sh("pkcs12", "-export", "-out", join(dir, "push.p12"), "-inkey", join(dir, "push.key"), "-in", join(dir, "push.crt"), "-passout", "pass:testpass");
    p12Der = new Uint8Array(await readFile(join(dir, "push.p12")));
    caCrt = await readFile(join(dir, "ca.crt"), "utf8");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("parsePushCertificate extracts topic, expiry, and PEMs", () => {
    const identity = parsePushCertificate(p12Der, "testpass");
    expect(identity.topic).toBe("com.apple.mgmt.External.test-topic");
    expect(identity.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(identity.keyPem).toContain("PRIVATE KEY");
    expect(identity.certPem).toContain("BEGIN CERTIFICATE");
    expect(() => parsePushCertificate(p12Der, "wrong")).toThrow();
  });

  test("parsePushCertificate rejects certificates without UID", async () => {
    await sh("req", "-newkey", "rsa:2048", "-keyout", join(dir, "no-uid.key"), "-out", join(dir, "no-uid.csr"), "-nodes", "-subj", "/CN=no-uid");
    await sh("x509", "-req", "-in", join(dir, "no-uid.csr"), "-CA", join(dir, "ca.crt"), "-CAkey", join(dir, "ca.key"), "-CAcreateserial", "-out", join(dir, "no-uid.crt"), "-days", "1");
    await sh("pkcs12", "-export", "-out", join(dir, "no-uid.p12"), "-inkey", join(dir, "no-uid.key"), "-in", join(dir, "no-uid.crt"), "-passout", "pass:testpass");
    const der = new Uint8Array(await readFile(join(dir, "no-uid.p12")));
    expect(() => parsePushCertificate(der, "testpass")).toThrow(
      "Failed to extract topic from push certificate",
    );
  });

  test("sendMdmNotification posts over mTLS HTTP/2", async () => {
    const identity = parsePushCertificate(p12Der, "testpass");
    const seen: Record<string, unknown> = {};
    const server = http2.createSecureServer({
      cert: await readFile(join(dir, "server.crt")),
      key: await readFile(join(dir, "server.key")),
      ca: await readFile(join(dir, "ca.crt")),
      requestCert: true,
      rejectUnauthorized: false,
    });
    server.on("stream", (stream: any, headers: any) => {
      seen.headers = headers;
      seen.peer = stream.session.socket.getPeerCertificate()?.subject;
      let body = "";
      stream.on("data", (chunk: Buffer) => (body += chunk));
      stream.on("end", () => {
        seen.body = body;
        stream.respond({ ":status": 200, "apns-id": "server-apns-id" });
        stream.end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const response = await sendMdmNotification(
        identity,
        { token: "deadbeef", pushMagic: "magic-1" },
        { host: "localhost", port, ca: caCrt },
      );
      expect(response.status).toBe(200);
      expect(response.apnsId).toBe("server-apns-id");
      expect(response.body).toEqual({});
      const headers = seen.headers as Record<string, string>;
      expect(headers[":path"]).toBe("/3/device/deadbeef");
      expect(headers["apns-push-type"]).toBe("alert");
      expect(headers["apns-id"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(headers["apns-topic"]).toBeUndefined();
      expect(JSON.parse(seen.body as string)).toEqual({ mdm: "magic-1" });
      expect(seen.peer).toMatchObject({ CN: "APSP:test" });
    } finally {
      server.close();
    }
  });

  test("sendMdmNotification refuses expired certificates", async () => {
    await expect(
      sendMdmNotification(
        {
          topic: "t",
          expiresAt: new Date(Date.now() - 1000),
          keyPem: "k",
          certPem: "c",
        },
        { token: "t", pushMagic: "m" },
      ),
    ).rejects.toThrow("Push certificate expired");
  });
});
