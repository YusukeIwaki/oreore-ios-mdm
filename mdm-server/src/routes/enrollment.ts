import { Hono, type Context } from "hono";
import { firstGetTokenTarget } from "../db/gettoken";
import { findIpaByFilename, ipaManifest } from "../db/ipa";
import type { AppEnv } from "../http/context";
import { buildPlist } from "../mdm/plist";
import { mdmEnrollmentProfile } from "../mdm/mobileconfig";
import { getPushIdentity } from "../mdm/push";
import { parseStoredFileData, assetFilesUrl } from "../storage/files";

/** Enrollment profiles, service discovery, manifests, asset downloads. */
export const enrollmentRoutes = new Hono<AppEnv>();

function byodDiscovery(baseUrl: string) {
  return { Servers: [{ Version: "mdm-byod", BaseURL: `${baseUrl}/mdm-byod/enroll` }] };
}

enrollmentRoutes.get("/mdm_service_discovery", (c) => {
  return c.json(byodDiscovery(c.get("config").baseUrl));
});

enrollmentRoutes.get("/MDMServiceConfig", (c) => {
  const baseUrl = c.get("config").baseUrl;
  return c.json({
    dep_enrollment_url: `${baseUrl}/mdm/dep_enroll`,
    dep_anchor_certs_url: `${baseUrl}/mdm/dep_anchor_certs`,
  });
});

async function renderMdmMobileconfig(c: Context<AppEnv>) {
  const config = c.get("config");
  const db = c.get("db");
  if (!config.deviceP12Der) {
    throw new Error("DEVICE_CERTIFICATE_BASE64 is not configured");
  }
  const target = await firstGetTokenTarget(db);
  const payload = mdmEnrollmentProfile({
    payloadUuid: config.payloadUuid,
    topic: getPushIdentity(config).topic,
    deviceP12Der: config.deviceP12Der,
    baseUrl: config.baseUrl,
    hasGetTokenTarget: target !== null,
  });
  return c.body(buildPlist(payload), 200, { "Content-Type": "application/x-apple-aspen-config" });
}

enrollmentRoutes.get("/mdm/dep_enroll", renderMdmMobileconfig);
enrollmentRoutes.post("/mdm/dep_enroll", renderMdmMobileconfig);

enrollmentRoutes.get("/mdm/dep_anchor_certs", (c) => {
  return c.json([]);
});

enrollmentRoutes.get("/mdm/appleconfigurator", (c) => c.text("OK"));
enrollmentRoutes.post("/mdm/appleconfigurator", renderMdmMobileconfig);

enrollmentRoutes.get("/mdm/service_discovery", (c) => {
  return c.json(byodDiscovery(c.get("config").baseUrl));
});

enrollmentRoutes.get("/mdm.mobileconfig", renderMdmMobileconfig);
enrollmentRoutes.post("/mdm.mobileconfig", renderMdmMobileconfig);

enrollmentRoutes.get("/ipa/:filename/manifest", async (c) => {
  const db = c.get("db");
  const config = c.get("config");
  const ipa = await findIpaByFilename(db, c.req.param("filename"));
  const downloadUrl = assetFilesUrl(config.baseUrl, parseStoredFileData(ipa.assetFileData));
  // No explicit content type in Ruby (Sinatra's text/html default).
  return c.html(ipaManifest(ipa.bundleIdentifier, downloadUrl));
});

enrollmentRoutes.get("/asset_files/*", async (c) => {
  const rest = new URL(c.req.url).pathname.replace(/^\/asset_files\//, "");
  const [storage, ...keyParts] = rest.split("/");
  const key = keyParts.join("/");
  if ((storage !== "store" && storage !== "cache") || key.length === 0) {
    return c.notFound();
  }
  let bytes: Uint8Array;
  try {
    bytes = await c.get("fileStore").readStored({ key, storage, metadata: {} });
  } catch {
    return c.notFound();
  }
  const filename = key.split("/").pop() ?? "file";
  if (filename.endsWith(".plist")) {
    return new Response(bytes as BodyInit, {
      status: 200,
      headers: { "Content-Type": "application/plist" },
    });
  }
  const contentType = filename.endsWith(".mobileconfig")
    ? "application/x-apple-aspen-config"
    : "application/octet-stream";
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
});
