import { eq } from "drizzle-orm";
import { buildPlist } from "../mdm/plist";
import { installApplication } from "../mdm/commands";
import type { Database } from "../db";
import { ipaFiles, mdmCommandRequests } from "../schema";
import { urlEncodeFilename } from "../vpp/token";
import { RecordNotFound } from "./accounts";

/** IPA metadata/manifest/dispatch (ported from `IpaFile` + `IpaInstallDispatcher`). */
export type IpaFileRow = typeof ipaFiles.$inferSelect;

export async function findIpaByFilename(db: Database, filename: string): Promise<IpaFileRow> {
  const [row] = await db.select().from(ipaFiles).where(eq(ipaFiles.filename, filename)).limit(1);
  if (!row) {
    throw new RecordNotFound(`no IpaFile with filename ${filename}`);
  }
  return row;
}

export function ipaManifestUrl(baseUrl: string, filename: string): string {
  return `${baseUrl}/ipa/${urlEncodeFilename(filename)}/manifest`;
}

export function ipaManifest(bundleIdentifier: string, downloadUrl: string): string {
  return buildPlist({
    items: [
      {
        assets: [{ kind: "software-package", url: downloadUrl }],
        metadata: {
          "bundle-identifier": bundleIdentifier,
          kind: "software",
          title: `Download ${bundleIdentifier}`,
        },
      },
    ],
  });
}

export function ipaToJson(
  baseUrl: string,
  row: IpaFileRow,
): {
  id: number;
  filename: string;
  bundleIdentifier: string;
  manifestUrl: string;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: row.id,
    filename: row.filename,
    bundleIdentifier: row.bundleIdentifier,
    manifestUrl: ipaManifestUrl(baseUrl, row.filename),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type DispatchDevice =
  | { kind: "mdm"; udid: string; serialNumber: string }
  | { kind: "byod"; enrollmentId: string };

export interface DispatchResult {
  enqueued: DispatchDevice[];
  pushSucceeded: DispatchDevice[];
  pushFailed: Array<{ device: DispatchDevice; error: string }>;
}

export function dispatchResultToJson(result: DispatchResult): Record<string, unknown> {
  const deviceToJson = (device: DispatchDevice): Record<string, unknown> =>
    device.kind === "mdm"
      ? { kind: "mdm", udid: device.udid, serial_number: device.serialNumber }
      : { kind: "byod", enrollment_id: device.enrollmentId };
  return {
    enqueued: result.enqueued.map(deviceToJson),
    push_succeeded: result.pushSucceeded.map(deviceToJson),
    push_failed: result.pushFailed.map((entry) => ({
      ...deviceToJson(entry.device),
      error: entry.error,
    })),
  };
}

/**
 * Enqueue one InstallApplication per device (each with its own CommandUUID)
 * and push-notify, isolating per-device failures.
 */
export async function dispatchIpaInstall(
  db: Database,
  options: {
    filename: string;
    devices: DispatchDevice[];
    baseUrl: string;
    pushEndpoints: Map<string, { token: string; pushMagic: string }>;
    sendPush: (endpoint: { token: string; pushMagic: string }) => Promise<unknown>;
  },
): Promise<DispatchResult> {
  const empty: DispatchResult = { enqueued: [], pushSucceeded: [], pushFailed: [] };
  if (options.devices.length === 0) {
    return empty;
  }
  const manifestUrl = ipaManifestUrl(options.baseUrl, options.filename);
  const identifiers = options.devices.map((device) =>
    device.kind === "mdm" ? device.udid : device.enrollmentId,
  );
  const payloads = options.devices.map(() => installApplication({ manifestUrl }));
  // Zip (not cartesian): exactly one command per device.
  const now = new Date();
  await db.insert(mdmCommandRequests).values(
    identifiers.map((deviceIdentifier, index) => ({
      deviceIdentifier,
      requestPayload: buildPlist(payloads[index]),
      createdAt: now,
    })),
  );

  const pushSucceeded: DispatchDevice[] = [];
  const pushFailed: DispatchResult["pushFailed"] = [];
  for (const device of options.devices) {
    const identifier = device.kind === "mdm" ? device.udid : device.enrollmentId;
    const endpoint = options.pushEndpoints.get(identifier);
    if (!endpoint) {
      pushFailed.push({ device, error: "no push endpoint" });
      continue;
    }
    try {
      await options.sendPush(endpoint);
      pushSucceeded.push(device);
    } catch (error) {
      pushFailed.push({ device, error: (error as Error).message });
    }
  }
  return { enqueued: options.devices, pushSucceeded, pushFailed };
}
