import { Hono, type Context } from "hono";
import QRCode from "qrcode";
import { parse as parseYaml } from "yaml";
import type { AppEnv } from "../http/context";
import { loginRequired } from "../http/adminAuth";
import { findByodPushEndpoint, findMdmPushEndpoint } from "../db/devices";
import {
  byodAccessTokenAttributes,
  createIpa,
  deleteIpa,
  deleteRtsProfile,
  enqueueTextareaCommand,
  findByodDeviceByEnrollment,
  findCommandHistoryByUuid,
  findDepTokenByFilename,
  findIpaById,
  findIpasForInstall,
  findMdmDeviceByUdid,
  findRtsProfileById,
  findSyncHistory,
  findVppTokenByFilename,
  installProfilePayloadXml,
  listByodDevices,
  listDepTokens,
  listIpaFiles,
  listMdmDevices,
  listRtsProfiles,
  listVppTokens,
  mdmDevicesOrderedBySerial,
  pushEndpointsForUdids,
  queueForIdentifier,
  syncHistoriesForDevice,
  updateIpa,
  upsertDepToken,
  upsertRtsProfile,
  upsertVppToken,
} from "../db/console";
import { dispatchIpaInstall, ipaManifest, ipaManifestUrl, type DispatchDevice } from "../db/ipa";
import { associateLicense, validateLicenseForm } from "../vpp/license";
import { buildDepPublicKeyPem } from "../dep/pubkey";
import { urlEncodeFilename } from "../vpp/token";
import { parseSerialNumbers } from "../db/ddm_admin";
import { assetFilesUrl, parseStoredFileData } from "../storage/files";
import { byodCommandForm, mdmCommandForm } from "./commandForm";
import {
  appleError,
  depClientFor,
  multiValues,
  pushSender,
  textField,
  uploadedFile,
  vppClientFor,
} from "./adminHelpers";
import {
  BYOD_COMMAND_OPTIONS,
  ByodDeviceShowPage,
  CommandHistoryPage,
  CommandRequestFormInner,
  DeviceShowPage,
  DevicesIndexPage,
  MDM_COMMAND_OPTIONS,
  SyncHistoryPage,
} from "../views/admin/devices";
import { RtsWifiProfilesPage } from "../views/admin/rts";
import { VppAssignmentsPage, VppIndexPage, VppShowPage } from "../views/admin/vpp";
import { IpaIndexPage, IpaShowPage, type InstallResultView } from "../views/admin/ipa";
import {
  DepAccountPage,
  DepAddeProfilePage,
  DepBetaTokensPage,
  DepDevicesPage,
  DepIndexPage,
  DepProfileNewPage,
  DepProfileShowPage,
  DepShowPage,
} from "../views/admin/dep";

/** Admin console: devices, RTS, VPP, IPA, DEP (DDM lives in `adminDdm.ts`). */
export const adminRoutes = new Hono<AppEnv>();

// Scoped to the console prefixes so unmatched paths (e.g. /favicon.ico) fall through to 404.
for (const prefix of [
  "/devices/*",
  "/byod/*",
  "/commands/*",
  "/dep/*",
  "/ipa/*",
  "/install_profile_payload",
  "/rts/*",
  "/vpp/*",
]) {
  adminRoutes.use(prefix, loginRequired());
}

// --- Devices ---

adminRoutes.get("/devices", async (c) => {
  const db = c.get("db");
  const [mdmDevices, byodDevices] = await Promise.all([listMdmDevices(db), listByodDevices(db)]);
  // Fixed width: without it the SVG has only a viewBox and stretches to the container width.
  // Fixed width: without it the SVG has only a viewBox and stretches to the container width.
  const qrSvg = await QRCode.toString(`${c.get("config").baseUrl}/mdm.mobileconfig`, {
    type: "svg",
    width: 120,
  });
  return c.html(
    DevicesIndexPage({
      devices: [
        ...mdmDevices.map((device) => ({
          href: `/devices/${device.udid}`,
          label: device.serialNumber,
        })),
        ...byodDevices.map((device) => ({
          href: `/byod/devices/${device.enrollmentId}`,
          label: device.enrollmentId,
        })),
      ],
      qrSvg,
    }),
  );
});

async function deviceShowData(c: Context<AppEnv>, udid: string) {
  const db = c.get("db");
  const device = await findMdmDeviceByUdid(db, udid);
  const form = await mdmCommandForm(c, device.serialNumber, {
    command: c.req.query("command"),
    ipa_file_id: c.req.query("ipa_file_id"),
    rts_wifi_profile_id: c.req.query("rts_wifi_profile_id"),
  });
  const queue = await queueForIdentifier(db, udid);
  const syncHistories = await syncHistoriesForDevice(db, udid);
  return { device, form, queue, syncHistories };
}

adminRoutes.get("/devices/:udid", async (c) => {
  const udid = c.req.param("udid");
  const { device, form, queue, syncHistories } = await deviceShowData(c, udid);
  return c.html(
    DeviceShowPage({
      udid,
      serialNumber: device.serialNumber,
      formInner: CommandRequestFormInner({
        endpointPath: `/devices/${udid}/command_request_form_inner`,
        selectedCommand: form.selected,
        commands: MDM_COMMAND_OPTIONS,
        payloadText: form.payloadText,
        installApplicationPicker: form.ipaPicker,
        eraseDevicePicker: form.rtsPicker,
      }),
      queue: {
        requests: queue.requests.map((row) => ({
          requestPayloadJson: row.requestPayload,
          createdAt: row.createdAt,
        })),
        handling: queue.handling.map((row) => ({
          requestPayloadJson: row.requestPayload,
          createdAt: row.createdAt,
        })),
        histories: queue.histories.map((row) => ({
          requestType: row.requestType,
          commandUuid: row.commandUuid,
          createdAt: row.createdAt,
        })),
      },
      syncHistories: syncHistories.map((row) => ({
        id: row.id,
        endpoint: row.endpoint,
        createdAt: row.createdAt,
      })),
    }),
  );
});

adminRoutes.get("/devices/:udid/command_request_form_inner", async (c) => {
  const udid = c.req.param("udid");
  const device = await findMdmDeviceByUdid(c.get("db"), udid);
  const form = await mdmCommandForm(c, device.serialNumber, {
    command: c.req.query("command"),
    ipa_file_id: c.req.query("ipa_file_id"),
    rts_wifi_profile_id: c.req.query("rts_wifi_profile_id"),
  });
  return c.html(
    CommandRequestFormInner({
      endpointPath: `/devices/${udid}/command_request_form_inner`,
      selectedCommand: form.selected,
      commands: MDM_COMMAND_OPTIONS,
      payloadText: form.payloadText,
      installApplicationPicker: form.ipaPicker,
      eraseDevicePicker: form.rtsPicker,
    }),
  );
});

adminRoutes.get("/devices/:udid/synchronization_request_histories/:id", async (c) => {
  const db = c.get("db");
  const device = await findMdmDeviceByUdid(db, c.req.param("udid"));
  const history = await findSyncHistory(db, device.udid, Number(c.req.param("id")));
  const pretty = (value: string | null) => {
    if (value === null) {
      return "null";
    }
    try {
      return JSON.stringify(JSON.parse(value) as unknown, null, 2);
    } catch {
      return value;
    }
  };
  return c.html(
    SyncHistoryPage({
      serialNumber: device.serialNumber,
      endpoint: history.endpoint,
      createdAt: history.createdAt,
      requestJson: pretty(history.requestPayload),
      responseJson: pretty(history.responsePayload),
    }),
  );
});

adminRoutes.get("/commands/:command_uuid", async (c) => {
  const history = await findCommandHistoryByUuid(c.get("db"), c.req.param("command_uuid"));
  return c.html(
    CommandHistoryPage({
      commandUuid: history.commandUuid,
      request: history.requestPayload,
      response: history.responsePayload,
    }),
  );
});

adminRoutes.post("/devices/:udid/commands", async (c) => {
  const db = c.get("db");
  const udid = c.req.param("udid");
  await findMdmDeviceByUdid(db, udid);
  const body = await c.req.parseBody();
  await enqueueTextareaCommand(db, udid, textField(body.payload));
  return c.redirect(`/devices/${udid}`);
});

adminRoutes.post("/install_profile_payload", async (c) => {
  const body = await c.req.parseBody();
  const file = await uploadedFile(body.mobileconfig_file);
  if (!file) {
    return c.text("mobileconfig_file is required", 400);
  }
  const xml = installProfilePayloadXml(Buffer.from(file.bytes).toString("utf8"));
  return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml" } });
});

adminRoutes.post("/devices/:udid/push", async (c) => {
  const db = c.get("db");
  const device = await findMdmDeviceByUdid(db, c.req.param("udid"));
  const endpoint = await findMdmPushEndpoint(db, device.id);
  if (!endpoint) {
    throw new Error(`no push endpoint for device ${device.udid}`);
  }
  const result = await pushSender(c)({ token: endpoint.token, pushMagic: endpoint.pushMagic });
  console.log(`push_result: ${JSON.stringify(result)}`);
  return c.redirect(`/devices/${device.udid}`);
});

// --- BYOD devices ---

adminRoutes.get("/byod/devices/:enrollment_id", async (c) => {
  const db = c.get("db");
  const enrollmentId = c.req.param("enrollment_id");
  const device = await findByodDeviceByEnrollment(db, enrollmentId);
  const form = byodCommandForm({ command: c.req.query("command") });
  const queue = await queueForIdentifier(db, enrollmentId);
  const tokenAttributes = await byodAccessTokenAttributes(db, enrollmentId);
  return c.html(
    ByodDeviceShowPage({
      enrollmentId: device.enrollmentId,
      accessTokenJson: JSON.stringify(tokenAttributes, null, 2),
      formInner: CommandRequestFormInner({
        endpointPath: `/byod/devices/${enrollmentId}/command_request_form_inner`,
        selectedCommand: form.selected,
        commands: BYOD_COMMAND_OPTIONS,
        payloadText: form.payloadText,
      }),
      queue: {
        requests: queue.requests.map((row) => ({
          requestPayloadJson: row.requestPayload,
          createdAt: row.createdAt,
        })),
        handling: queue.handling.map((row) => ({
          requestPayloadJson: row.requestPayload,
          createdAt: row.createdAt,
        })),
        histories: queue.histories.map((row) => ({
          requestType: row.requestType,
          commandUuid: row.commandUuid,
          createdAt: row.createdAt,
        })),
      },
    }),
  );
});

adminRoutes.get("/byod/devices/:enrollment_id/command_request_form_inner", async (c) => {
  const enrollmentId = c.req.param("enrollment_id");
  await findByodDeviceByEnrollment(c.get("db"), enrollmentId);
  const form = byodCommandForm({ command: c.req.query("command") });
  return c.html(
    CommandRequestFormInner({
      endpointPath: `/byod/devices/${enrollmentId}/command_request_form_inner`,
      selectedCommand: form.selected,
      commands: BYOD_COMMAND_OPTIONS,
      payloadText: form.payloadText,
    }),
  );
});

adminRoutes.post("/byod/devices/:enrollment_id/commands", async (c) => {
  const db = c.get("db");
  const enrollmentId = c.req.param("enrollment_id");
  await findByodDeviceByEnrollment(db, enrollmentId);
  const body = await c.req.parseBody();
  await enqueueTextareaCommand(db, enrollmentId, textField(body.payload));
  return c.redirect(`/byod/devices/${enrollmentId}`);
});

adminRoutes.post("/byod/devices/:enrollment_id/push", async (c) => {
  const db = c.get("db");
  const device = await findByodDeviceByEnrollment(db, c.req.param("enrollment_id"));
  const endpoint = await findByodPushEndpoint(db, device.id);
  if (!endpoint) {
    throw new Error(`no push endpoint for enrollment ${device.enrollmentId}`);
  }
  const result = await pushSender(c)({ token: endpoint.token, pushMagic: endpoint.pushMagic });
  console.log(`push_result: ${JSON.stringify(result)}`);
  return c.redirect(`/byod/devices/${device.enrollmentId}`);
});

// --- RTS ---

adminRoutes.get("/rts/wifi_profiles", async (c) => {
  const profiles = await listRtsProfiles(c.get("db"));
  return c.html(
    RtsWifiProfilesPage({
      selected: null,
      profiles: profiles.map((profile) => ({ id: profile.id, name: profile.name })),
    }),
  );
});

adminRoutes.get("/rts/wifi_profiles/:id", async (c) => {
  const db = c.get("db");
  const profile = await findRtsProfileById(db, Number(c.req.param("id")));
  const content = Buffer.from(
    await c.get("fileStore").readStored(parseStoredFileData(profile.assetFileData)),
  ).toString("utf8");
  const profiles = await listRtsProfiles(db);
  return c.html(
    RtsWifiProfilesPage({
      selected: { id: profile.id, name: profile.name, content },
      profiles: profiles.map((row) => ({ id: row.id, name: row.name })),
    }),
  );
});

adminRoutes.post("/rts/wifi_profiles", async (c) => {
  const body = await c.req.parseBody();
  const file = await uploadedFile(body.asset_file);
  if (file) {
    await upsertRtsProfile(c.get("db"), c.get("fileStore"), {
      name: textField(body.name),
      file,
    });
  }
  return c.redirect("/rts/wifi_profiles");
});

adminRoutes.post("/rts/wifi_profiles/:id/delete", async (c) => {
  await deleteRtsProfile(c.get("db"), c.get("fileStore"), Number(c.req.param("id")));
  return c.redirect("/rts/wifi_profiles");
});

// --- VPP ---

adminRoutes.get("/vpp", async (c) => {
  const tokens = await listVppTokens(c.get("db"));
  return c.html(VppIndexPage({ tokens: tokens.map((token) => ({ filename: token.filename })) }));
});

adminRoutes.post("/vpp", async (c) => {
  const body = await c.req.parseBody();
  const file = await uploadedFile(body.vpptoken_file);
  if (file) {
    await upsertVppToken(c.get("db"), file.filename, Buffer.from(file.bytes).toString("utf8"));
  }
  return c.redirect("/vpp");
});

adminRoutes.get("/vpp/:filename", async (c) => {
  const filename = c.req.param("filename");
  const token = await findVppTokenByFilename(c.get("db"), filename);
  const response = (await vppClientFor(c, token.value).get("assets")) as {
    assets?: Record<string, unknown>[];
  };
  return c.html(VppShowPage({ filename, assets: response.assets ?? [] }));
});

adminRoutes.get("/vpp/:filename/:adam_id", async (c) => {
  const filename = c.req.param("filename");
  const adamId = c.req.param("adam_id");
  const token = await findVppTokenByFilename(c.get("db"), filename);
  const client = vppClientFor(c, token.value);
  const pageIndex = c.req.query("page_index") ?? "";
  const showAppInfo = pageIndex === "";
  const appInfo = showAppInfo ? await client.fetchAppInformation(adamId) : null;
  const params: Record<string, string> = { adamId };
  if (pageIndex !== "") {
    params.pageIndex = pageIndex;
  }
  const response = (await client.get("assignments", params)) as {
    assignments?: Record<string, unknown>[];
    currentPageIndex?: unknown;
    totalPages?: unknown;
  };
  return c.html(
    VppAssignmentsPage({
      filename,
      adamId,
      appInfo,
      showAppInfo,
      assignments: response.assignments ?? [],
      currentPageIndex: typeof response.currentPageIndex === "number" ? response.currentPageIndex : 0,
      totalPages: typeof response.totalPages === "number" ? response.totalPages : 0,
    }),
  );
});

adminRoutes.get("/vpp/:filename/:adam_id/assignments", async (c) => {
  // Just in case the POST URL was bookmarked through the login redirect.
  const token = await findVppTokenByFilename(c.get("db"), c.req.param("filename"));
  return c.redirect(`/vpp/${urlEncodeFilename(token.filename)}/${c.req.param("adam_id")}`);
});

adminRoutes.post("/vpp/:filename/:adam_id/assignments", async (c) => {
  const db = c.get("db");
  const token = await findVppTokenByFilename(db, c.req.param("filename"));
  const adamId = c.req.param("adam_id");
  const body = await c.req.parseBody();
  const form = { adam_id: adamId, serial_number: textField(body.serial_number) };
  if (validateLicenseForm(form)) {
    await associateLicense(vppClientFor(c, token.value), form);
  }
  return c.redirect(`/vpp/${urlEncodeFilename(token.filename)}/${adamId}`);
});

// --- IPA ---

async function renderIpaShow(
  c: Context<AppEnv>,
  ipa: { id: number; filename: string; bundleIdentifier: string; assetFileData: string },
  installResult: InstallResultView | null,
) {
  const config = c.get("config");
  const devices = await mdmDevicesOrderedBySerial(c.get("db"));
  const downloadUrl = assetFilesUrl(config.baseUrl, parseStoredFileData(ipa.assetFileData));
  return c.html(
    IpaShowPage({
      id: ipa.id,
      filename: ipa.filename,
      bundleIdentifier: ipa.bundleIdentifier,
      manifestUrl: ipaManifestUrl(config.baseUrl, ipa.filename),
      manifestXml: ipaManifest(ipa.bundleIdentifier, downloadUrl),
      devices: devices.map((device) => ({ udid: device.udid, serialNumber: device.serialNumber })),
      installResult,
    }),
  );
}

adminRoutes.get("/ipa", async (c) => {
  const ipas = await listIpaFiles(c.get("db"));
  return c.html(IpaIndexPage({ ipas: ipas.map((ipa) => ({ filename: ipa.filename })) }));
});

adminRoutes.post("/ipa", async (c) => {
  const body = await c.req.parseBody();
  const file = await uploadedFile(body.asset_file);
  if (file) {
    await createIpa(c.get("db"), c.get("fileStore"), {
      bundleIdentifier: textField(body.bundle_identifier),
      filename: file.filename,
      file,
    });
  }
  return c.redirect("/ipa");
});

adminRoutes.get("/ipa/:filename", async (c) => {
  const filename = c.req.param("filename");
  const ipas = await listIpaFiles(c.get("db"));
  const ipa = ipas.find((row) => row.filename === filename);
  if (!ipa) {
    throw new Error(`no IpaFile with filename ${filename}`);
  }
  return renderIpaShow(c, ipa, null);
});

adminRoutes.post("/ipa/:id/install", async (c) => {
  const db = c.get("db");
  const config = c.get("config");
  const ipa = await findIpaById(db, Number(c.req.param("id")));
  const body = await c.req.parseBody();
  const udids = multiValues(body as Record<string, unknown>, "device_identifiers");
  const devices = await findIpasForInstall(db, udids);
  const endpoints = await pushEndpointsForUdids(
    db,
    devices.map((device) => device.udid),
  );
  const dispatchDevices: DispatchDevice[] = devices.map((device) => ({
    kind: "mdm",
    udid: device.udid,
    serialNumber: device.serialNumber,
  }));
  const result = await dispatchIpaInstall(db, {
    filename: ipa.filename,
    devices: dispatchDevices,
    baseUrl: config.baseUrl,
    pushEndpoints: endpoints,
    sendPush: pushSender(c),
  });
  const view: InstallResultView = {
    enqueued: result.enqueued.length,
    pushSucceeded: result.pushSucceeded.length,
    failures: result.pushFailed.map((entry) => ({
      serialNumber: entry.device.kind === "mdm" ? entry.device.serialNumber : "",
      udid: entry.device.kind === "mdm" ? entry.device.udid : "",
      error: entry.error,
    })),
  };
  return renderIpaShow(c, ipa, view);
});

adminRoutes.post("/ipa/:id/update", async (c) => {
  const db = c.get("db");
  const id = Number(c.req.param("id"));
  const body = await c.req.parseBody();
  const file = await uploadedFile(body.asset_file);
  const patch: { bundleIdentifier?: string; filename?: string; file?: NonNullable<Awaited<ReturnType<typeof uploadedFile>>> } = {};
  const bundleIdentifier = textField(body.bundle_identifier);
  if (bundleIdentifier !== undefined) {
    patch.bundleIdentifier = bundleIdentifier;
  }
  if (file) {
    patch.filename = file.filename;
    patch.file = file;
  }
  const ipa = await updateIpa(db, c.get("fileStore"), id, patch);
  return c.redirect(`/ipa/${urlEncodeFilename(ipa.filename)}`);
});

adminRoutes.post("/ipa/:id/delete", async (c) => {
  await deleteIpa(c.get("db"), c.get("fileStore"), Number(c.req.param("id")));
  return c.redirect("/ipa");
});

// --- DEP ---

adminRoutes.get("/dep", async (c) => {
  const tokens = await listDepTokens(c.get("db"));
  return c.html(DepIndexPage({ tokens: tokens.map((token) => ({ filename: token.filename })) }));
});

adminRoutes.post("/dep", async (c) => {
  const config = c.get("config");
  const body = await c.req.parseBody();
  const file = await uploadedFile(body.dep_token_file);
  if (file) {
    if (!config.depKeyPem) {
      throw new Error("DEP_KEY_BASE64 is not configured");
    }
    await upsertDepToken(c.get("db"), file.filename, file.bytes, config.depKeyPem);
  }
  const tokens = await listDepTokens(c.get("db"));
  return c.html(DepIndexPage({ tokens: tokens.map((token) => ({ filename: token.filename })) }));
});

adminRoutes.get("/dep/pub_key.pem", async (c) => {
  const config = c.get("config");
  if (!config.depKeyPem) {
    throw new Error("DEP_KEY_BASE64 is not configured");
  }
  const pem = buildDepPublicKeyPem(config.depKeyPem);
  return new Response(pem, {
    status: 200,
    headers: {
      "Content-Type": "application/x-pem-file",
      "Content-Disposition": 'attachment; filename="pub_key.pem"',
    },
  });
});

adminRoutes.get("/dep/:filename", async (c) => {
  const token = await findDepTokenByFilename(c.get("db"), c.req.param("filename"));
  return c.html(DepShowPage({ filename: token.filename }));
});

adminRoutes.get("/dep/:filename/account", async (c) => {
  const token = await findDepTokenByFilename(c.get("db"), c.req.param("filename"));
  const client = depClientFor(c, token);
  try {
    const account = await client.get("account");
    return c.html(DepAccountPage({ filename: token.filename, accountJson: account, error: null }));
  } catch (error) {
    return c.html(
      DepAccountPage({ filename: token.filename, accountJson: null, error: appleError(error) }),
    );
  }
});

adminRoutes.get("/dep/:filename/os_beta_enrollment_tokens", async (c) => {
  const token = await findDepTokenByFilename(c.get("db"), c.req.param("filename"));
  const response = (await depClientFor(c, token).get("os-beta-enrollment/tokens")) as {
    betaEnrollmentTokens?: { title?: unknown; os?: unknown; token?: unknown }[];
  };
  return c.html(
    DepBetaTokensPage({
      filename: token.filename,
      tokens: (response.betaEnrollmentTokens ?? []).map((entry) => ({
        title: String(entry.title ?? ""),
        os: String(entry.os ?? ""),
        token: String(entry.token ?? ""),
      })),
    }),
  );
});

adminRoutes.get("/dep/:filename/account_driven_enrollment_profile", async (c) => {
  const token = await findDepTokenByFilename(c.get("db"), c.req.param("filename"));
  let profile: Record<string, unknown> = {};
  try {
    profile = (await depClientFor(c, token).get("account-driven-enrollment/profile")) as Record<
      string,
      unknown
    >;
  } catch {
    profile = {};
  }
  return c.html(
    DepAddeProfilePage({
      filename: token.filename,
      discoveryUrl:
        typeof profile.mdm_service_discovery_url === "string"
          ? profile.mdm_service_discovery_url
          : "",
      lastUpdatedTimestamp:
        typeof profile.last_updated_timestamp === "string" ? profile.last_updated_timestamp : "",
      baseUrl: c.get("config").baseUrl,
    }),
  );
});

adminRoutes.post("/dep/:filename/account_driven_enrollment_profile", async (c) => {
  const token = await findDepTokenByFilename(c.get("db"), c.req.param("filename"));
  const body = await c.req.parseBody();
  const url = body.url;
  const client = depClientFor(c, token);
  if (url === "") {
    await client.delete("account-driven-enrollment/profile");
  } else if (typeof url === "string") {
    await client.post("account-driven-enrollment/profile", { mdm_service_discovery_url: url });
  }
  return c.redirect(`/dep/${c.req.param("filename")}/account_driven_enrollment_profile`);
});

async function renderDepDevices(
  c: Context<AppEnv>,
  filename: string,
  serialNumber: string | undefined,
) {
  const token = await findDepTokenByFilename(c.get("db"), filename);
  const client = depClientFor(c, token);
  try {
    if (serialNumber) {
      const response = (await client.post("devices", { devices: [serialNumber] })) as {
        devices?: Record<string, Record<string, unknown>>;
      };
      const device = response.devices?.[serialNumber] ?? { serial_number: serialNumber };
      return c.html(
        DepDevicesPage({
          filename: token.filename,
          devices: [device],
          fetchedUntil: "",
          moreToFollow: false,
          cursor: "",
          singleDevice: true,
          error: null,
        }),
      );
    }
    const cursor = c.req.query("cursor");
    const response = (await client.post(
      "server/devices",
      cursor ? { cursor } : {},
    )) as {
      devices?: Record<string, unknown>[];
      fetched_until?: unknown;
      more_to_follow?: unknown;
      cursor?: unknown;
    };
    return c.html(
      DepDevicesPage({
        filename: token.filename,
        devices: response.devices ?? [],
        fetchedUntil: String(response.fetched_until ?? ""),
        moreToFollow: response.more_to_follow === true,
        cursor: String(response.cursor ?? ""),
        singleDevice: false,
        error: null,
      }),
    );
  } catch (error) {
    return c.html(
      DepDevicesPage({
        filename: token.filename,
        devices: [],
        fetchedUntil: "",
        moreToFollow: false,
        cursor: "",
        singleDevice: serialNumber !== undefined,
        error: appleError(error),
      }),
    );
  }
}

adminRoutes.get("/dep/:filename/devices", async (c) => {
  return renderDepDevices(c, c.req.param("filename"), undefined);
});

adminRoutes.get("/dep/:filename/devices/:serial_number", async (c) => {
  const serial = c.req.param("serial_number");
  return renderDepDevices(c, c.req.param("filename"), serial === "" ? undefined : serial);
});

adminRoutes.get("/dep/:filename/devices/:serial_number/remove_profile", async (c) => {
  const db = c.get("db");
  const filename = c.req.param("filename");
  const serial = c.req.param("serial_number").trim();
  if (serial !== "") {
    const token = await findDepTokenByFilename(db, filename);
    const client = depClientFor(c, token);
    const response = (await client.post("devices", { devices: [serial] })) as {
      devices?: Record<string, { profile_uuid?: unknown }>;
    };
    const profileUuid = response.devices?.[serial]?.profile_uuid;
    if (typeof profileUuid === "string" && profileUuid !== "") {
      await client.delete("profile/devices", { profile_uuid: profileUuid, devices: [serial] });
    }
  }
  return c.redirect(`/dep/${filename}/devices/${serial}`);
});

adminRoutes.get("/dep/:filename/profiles/:profile_uuid", async (c) => {
  const filename = c.req.param("filename");
  const profileUuid = c.req.param("profile_uuid");
  const token = await findDepTokenByFilename(c.get("db"), filename);
  if (profileUuid === "new") {
    return c.html(
      DepProfileNewPage({
        filename: token.filename,
        baseUrl: c.get("config").baseUrl,
        serialNumber: c.req.query("serial_number") ?? "",
      }),
    );
  }
  const profile = await depClientFor(c, token).get("profile", { profile_uuid: profileUuid });
  return c.html(
    DepProfileShowPage({ filename: token.filename, profileUuid, profileJson: profile }),
  );
});

adminRoutes.post("/dep/:filename/profiles", async (c) => {
  const token = await findDepTokenByFilename(c.get("db"), c.req.param("filename"));
  const body = await c.req.parseBody();
  const payload = parseYaml(textField(body.payload) ?? "");
  const response = (await depClientFor(c, token).post("profile", payload)) as {
    devices?: Record<string, unknown>;
    profile_uuid?: unknown;
  };
  const devices = response.devices ?? {};
  const encoded = urlEncodeFilename(token.filename);
  if (Object.keys(devices).length === 1) {
    return c.redirect(`/dep/${encoded}/devices/${Object.keys(devices)[0]}`);
  }
  return c.redirect(`/dep/${encoded}/profiles/${String(response.profile_uuid ?? "")}`);
});

adminRoutes.post("/dep/:filename/profiles/:profile_uuid/assign", async (c) => {
  const token = await findDepTokenByFilename(c.get("db"), c.req.param("filename"));
  const body = await c.req.parseBody();
  const serialNumbers = parseSerialNumbers(textField(body.serial_numbers));
  const response = (await depClientFor(c, token).post("profile/devices", {
    profile_uuid: c.req.param("profile_uuid"),
    devices: serialNumbers,
  })) as { profile_uuid?: unknown };
  const encoded = urlEncodeFilename(token.filename);
  return c.redirect(`/dep/${encoded}/profiles/${String(response.profile_uuid ?? "")}`);
});
