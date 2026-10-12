import { randomBytes } from "node:crypto";

/**
 * Application configuration, loaded once at startup from the environment.
 * Attached to the Hono context by middleware so routes stay testable.
 */
export interface AppConfig {
  port: number;
  /** MDM_SERVER_BASE_URL */
  baseUrl: string;
  databaseUrl: string;
  sessionSecret: string;
  secureCookies: boolean;
  /** MDM_MOBILECONFIG_PAYLOAD_UUID */
  payloadUuid: string;
  pushCertificate: { der: Uint8Array; password: string } | null;
  deviceP12Der: Uint8Array | null;
  /** DEP_KEY_BASE64 decoded to PEM text. */
  depKeyPem: string | null;
  apiToken: string | null;
  google: { clientId: string; clientSecret: string } | null;
  allowedDomains: string[];
  allowedUsers: string[];
  s3: {
    bucket: string;
    endpoint?: string;
    region?: string;
    accessKeyId: string;
    secretAccessKey: string;
  } | null;
  uploadDir: string;
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function decodeBase64(value: string | undefined): Uint8Array | null {
  if (!value) {
    return null;
  }
  return Buffer.from(value, "base64");
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const baseUrl = env.MDM_SERVER_BASE_URL ?? "";
  const pushDer = decodeBase64(env.PUSH_CERTIFICATE_BASE64);
  const pushPassword = env.PUSH_CERTIFICATE_PASSWORD;
  const depKey = decodeBase64(env.DEP_KEY_BASE64);
  const googleClientId = env.GOOGLE_CLIENT_ID;
  const s3Bucket = env.S3_BUCKET;

  return {
    port: Number(env.PORT ?? 3000),
    baseUrl,
    databaseUrl: env.DATABASE_URL ?? "",
    sessionSecret: env.SESSION_SECRET ?? randomBytes(32).toString("hex"),
    secureCookies: baseUrl.startsWith("https://"),
    payloadUuid: env.MDM_MOBILECONFIG_PAYLOAD_UUID ?? "",
    pushCertificate:
      pushDer && pushPassword ? { der: pushDer, password: pushPassword } : null,
    deviceP12Der: decodeBase64(env.DEVICE_CERTIFICATE_BASE64),
    depKeyPem: depKey ? Buffer.from(depKey).toString("utf8") : null,
    apiToken: env.MDM_API_TOKEN ?? null,
    google:
      googleClientId && env.GOOGLE_CLIENT_SECRET
        ? { clientId: googleClientId, clientSecret: env.GOOGLE_CLIENT_SECRET }
        : null,
    allowedDomains: splitList(env.GOOGLE_ALLOWED_DOMAINS),
    allowedUsers: splitList(env.GOOGLE_ALLOWED_USERS),
    s3:
      s3Bucket && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? {
            bucket: s3Bucket,
            endpoint: env.S3_ENDPOINT,
            region: env.S3_REGION,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          }
        : null,
    uploadDir: env.UPLOAD_DIR ?? "./uploads",
  };
}
