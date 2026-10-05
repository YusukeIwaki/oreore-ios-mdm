import type { Context } from "hono";
import type { AppEnv } from "../http/context";
import { declarationInputFor } from "../db/ddm";
import { firstGetTokenTarget } from "../db/gettoken";
import {
  findIpaById,
  findRtsProfileById,
  ipasOrderedByFilename,
  rtsProfilesOrderedByName,
} from "../db/console";
import { Declaration } from "../ddm/declaration";
import {
  declarativeManagement,
  deviceInformation,
  deviceLocation,
  disableLostMode,
  enableLostMode,
  eraseDevice,
  installApplication,
  installProfileTemplate,
  installedApplicationList,
  profileList,
  removeProfileTemplate,
  type CommandPayload,
} from "../mdm/commands";
import { mdmEnrollmentProfile } from "../mdm/mobileconfig";
import { buildPlist } from "../mdm/plist";
import { getPushIdentity } from "../mdm/push";
import { ipaManifestUrl } from "../db/ipa";
import { assetFilesUrl, parseStoredFileData } from "../storage/files";
import type { PickerItem } from "../views/admin/devices";

export interface CommandFormData {
  selected: string;
  payloadText: string;
  ipaPicker?: { items: PickerItem[] };
  rtsPicker?: { items: PickerItem[] };
}

/** Plain `klass.new` / `template_new` commands shared by the MDM and BYOD forms. */
function simpleCommandTemplate(name: string): CommandPayload | null {
  switch (name) {
    case "DeviceInformation":
      return deviceInformation();
    case "InstalledApplicationList":
      return installedApplicationList();
    case "ProfileList":
      return profileList();
    case "InstallProfile":
      return installProfileTemplate();
    case "RemoveProfile":
      return removeProfileTemplate();
    case "EnableLostMode":
      return enableLostMode();
    case "DeviceLocation":
      return deviceLocation();
    case "DisableLostMode":
      return disableLostMode();
    default:
      return null;
  }
}

/** Full MDM form: template pickers + DeclarativeManagement/Install/Erase branches. */
export async function mdmCommandForm(
  c: Context<AppEnv>,
  serialNumber: string,
  query: { command?: string; ipa_file_id?: string; rts_wifi_profile_id?: string },
): Promise<CommandFormData> {
  const db = c.get("db");
  const config = c.get("config");
  const selected = query.command ?? "";
  if (selected === "DeclarativeManagement") {
    const input = await declarationInputFor(db, serialNumber, (_assetName, assetFileData) =>
      assetFilesUrl(config.baseUrl, parseStoredFileData(assetFileData)),
    );
    const payload = declarativeManagement({ tokens: new Declaration(input).tokens() });
    return { selected, payloadText: buildPlist(payload).trim() };
  }
  if (selected === "InstallApplication") {
    const ipas = await ipasOrderedByFilename(db);
    const selectedIpa = query.ipa_file_id
      ? await findIpaById(db, Number(query.ipa_file_id))
      : (ipas[0] ?? null);
    return {
      selected,
      payloadText: selectedIpa
        ? buildPlist(
            installApplication({ manifestUrl: ipaManifestUrl(config.baseUrl, selectedIpa.filename) }),
          ).trim()
        : "",
      ipaPicker: {
        items: ipas.map((ipa) => ({
          id: ipa.id,
          label: ipa.filename,
          active: selectedIpa !== null && ipa.id === selectedIpa.id,
        })),
      },
    };
  }
  if (selected === "EraseDevice") {
    const profiles = await rtsProfilesOrderedByName(db);
    const selectedProfile = query.rts_wifi_profile_id
      ? await findRtsProfileById(db, Number(query.rts_wifi_profile_id))
      : (profiles[0] ?? null);
    let payload: CommandPayload;
    if (selectedProfile) {
      if (!config.deviceP12Der) {
        throw new Error("DEVICE_CERTIFICATE_BASE64 is not configured");
      }
      const target = await firstGetTokenTarget(db);
      const wifiData = await c
        .get("fileStore")
        .readStored(parseStoredFileData(selectedProfile.assetFileData));
      const mdmProfile = buildPlist(
        mdmEnrollmentProfile({
          payloadUuid: config.payloadUuid,
          topic: getPushIdentity(config).topic,
          deviceP12Der: config.deviceP12Der,
          baseUrl: config.baseUrl,
          hasGetTokenTarget: target !== null,
        }),
      );
      payload = eraseDevice({
        rtsEnabled: true,
        rtsWifiProfileData: wifiData,
        rtsMdmProfileData: mdmProfile,
      });
    } else {
      payload = eraseDevice({ rtsEnabled: false });
    }
    return {
      selected,
      payloadText: buildPlist(payload).trim(),
      rtsPicker: {
        items: profiles.map((profile) => ({
          id: profile.id,
          label: profile.name,
          active: selectedProfile !== null && profile.id === selectedProfile.id,
        })),
      },
    };
  }
  const template = selected !== "" ? simpleCommandTemplate(selected) : null;
  return { selected, payloadText: template ? buildPlist(template).trim() : "" };
}

/** BYOD form: same simple commands, no install/erase branches. */
export function byodCommandForm(query: { command?: string }): CommandFormData {
  const selected = query.command ?? "";
  const template = selected !== "" ? simpleCommandTemplate(selected) : null;
  return { selected, payloadText: template ? buildPlist(template).trim() : "" };
}
