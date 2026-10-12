import http2 from "node:http2";
import { randomUUID } from "node:crypto";
import forge from "node-forge";

/**
 * APNs MDM push (ported from `PushCertificate` + `PushClient`).
 * Certificate auth over HTTP/2, mirroring the apnotic request exactly:
 * `POST /3/device/<token>` with `apns-id` + `apns-push-type: alert` and a
 * `{"mdm": push_magic}` JSON body. No `apns-topic` (single-topic cert).
 */

const UID_OID = "0.9.2342.19200300.100.1.1";

export interface PushIdentity {
  topic: string;
  expiresAt: Date;
  keyPem: string;
  certPem: string;
}

const identityCache = new WeakMap<object, PushIdentity>();

/** Parse (once) and cache the push identity from the app config. */
export function getPushIdentity(config: {
  pushCertificate: { der: Uint8Array; password: string } | null;
}): PushIdentity {
  if (!config.pushCertificate) {
    throw new Error("PUSH_CERTIFICATE_BASE64 / PUSH_CERTIFICATE_PASSWORD are not configured");
  }
  let identity = identityCache.get(config);
  if (!identity) {
    identity = parsePushCertificate(
      config.pushCertificate.der,
      config.pushCertificate.password,
    );
    identityCache.set(config, identity);
  }
  return identity;
}

export function parsePushCertificate(der: Uint8Array, password: string): PushIdentity {
  const asn1 = forge.asn1.fromDer(
    forge.util.createBuffer(Buffer.from(der).toString("binary")),
  );
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const keyBags =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] ?? [];
  const cert = certBags[0]?.cert;
  const key = keyBags[0]?.key;
  if (!cert || !key) {
    throw new Error("push .p12 archive contains no certificate/key pair");
  }
  const topic = cert.subject.attributes.find((attribute) => attribute.type === UID_OID)?.value;
  if (typeof topic !== "string" || topic.length === 0) {
    throw new Error("Failed to extract topic from push certificate");
  }
  return {
    topic,
    expiresAt: cert.validity.notAfter,
    keyPem: forge.pki.privateKeyToPem(key),
    certPem: forge.pki.certificateToPem(cert),
  };
}

export interface PushEndpoint {
  token: string;
  pushMagic: string;
}

export interface PushResponse {
  status: number;
  apnsId: string | null;
  body: Record<string, unknown>;
}

export interface PushClientOptions {
  host?: string;
  port?: number;
  /** Test-only CA for self-signed APNs stand-ins. */
  ca?: string | Buffer;
}

export async function sendMdmNotification(
  identity: PushIdentity,
  endpoint: PushEndpoint,
  options: PushClientOptions = {},
): Promise<PushResponse> {
  if (identity.expiresAt.getTime() < Date.now()) {
    throw new Error("Push certificate expired");
  }
  const host = options.host ?? "api.push.apple.com";
  const port = options.port ?? 443;
  const session = http2.connect(`https://${host}:${port}`, {
    key: identity.keyPem,
    cert: identity.certPem,
    ...(options.ca !== undefined ? { ca: options.ca } : {}),
  });
  try {
    await new Promise<void>((resolve, reject) => {
      session.on("error", reject);
      session.on("connect", () => resolve());
    });
    const request = session.request({
      ":method": "POST",
      ":path": `/3/device/${endpoint.token}`,
      "apns-id": randomUUID(),
      "apns-push-type": "alert",
    });
    // Send the body immediately: waiting for the response first would deadlock
    // against servers that read the request before responding.
    const completed = new Promise<PushResponse>((resolve, reject) => {
      let headers: Record<string, string> = {};
      const chunks: Buffer[] = [];
      request.on("response", (responseHeaders) => {
        headers = responseHeaders as Record<string, string>;
      });
      request.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: Number(headers[":status"]),
          apnsId: headers["apns-id"] ?? null,
          body: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {},
        });
      });
      request.on("error", reject);
    });
    request.end(JSON.stringify({ mdm: endpoint.pushMagic }));
    return await completed;
  } finally {
    session.close();
  }
}
