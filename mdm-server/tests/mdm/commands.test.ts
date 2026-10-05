import { describe, expect, test } from "bun:test";
import {
  declarativeManagement,
  deviceInformation,
  deviceLocation,
  disableLostMode,
  enableLostMode,
  eraseDevice,
  installApplication,
  installProfile,
  installProfileTemplate,
  installedApplicationList,
  profileList,
  removeProfile,
  removeProfileTemplate,
} from "../../src/mdm/commands";

describe("command builders", () => {
  test("deviceInformation", () => {
    const payload = deviceInformation({ commandUuid: "uuid-1" });
    expect(payload.CommandUUID).toBe("uuid-1");
    expect(payload.Command.RequestType).toBe("DeviceInformation");
    expect(payload.Command.Queries).toEqual([
      "UDID",
      "OrganizationInfo",
      "AwaitingConfiguration",
      "MDMOptions",
      "DeviceName",
      "OSVersion",
      "SupplementalOSVersionExtra",
      "BuildVersion",
      "SupplementalBuildVersion",
      "ModelName",
      "Model",
      "ModelNumber",
      "IsAppleSilicon",
      "ProductName",
      "SerialNumber",
      "IMEI",
      "MEID",
      "HostName",
      "IsNetworkTethered",
    ]);
    expect(Object.keys(payload)).toEqual(["CommandUUID", "Command"]);
  });

  test("deviceLocation / disableLostMode / profileList", () => {
    expect(deviceLocation({ commandUuid: "u" })).toEqual({
      CommandUUID: "u",
      Command: { RequestType: "DeviceLocation" },
    });
    expect(disableLostMode({ commandUuid: "u" }).Command).toEqual({
      RequestType: "DisableLostMode",
    });
    expect(profileList({ commandUuid: "u" }).Command).toEqual({ RequestType: "ProfileList" });
  });

  test("enableLostMode omits missing fields", () => {
    expect(enableLostMode({ commandUuid: "u" }).Command).toEqual({
      RequestType: "EnableLostMode",
    });
    expect(
      enableLostMode({ commandUuid: "u", message: "m", phoneNumber: "p", footnote: "f" }).Command,
    ).toEqual({
      RequestType: "EnableLostMode",
      Message: "m",
      PhoneNumber: "p",
      Footnote: "f",
    });
  });

  test("eraseDevice without RTS", () => {
    expect(eraseDevice({ commandUuid: "u", rtsEnabled: false })).toEqual({
      CommandUUID: "u",
      Command: { RequestType: "EraseDevice", PreserveDataPlan: true },
    });
  });

  test("eraseDevice with RTS embeds profile bytes", () => {
    const payload = eraseDevice({
      commandUuid: "u",
      rtsEnabled: true,
      rtsWifiProfileData: "wifi-bytes",
      rtsMdmProfileData: Buffer.from([9, 9]),
    });
    expect(payload.Command.RequestType).toBe("EraseDevice");
    const rts = payload.Command.ReturnToService as Record<string, unknown>;
    expect(rts.Enabled).toBe(true);
    expect((rts.WiFiProfileData as Buffer).toString()).toBe("wifi-bytes");
    expect([...(rts.MDMProfileData as Buffer)]).toEqual([9, 9]);
  });

  test("eraseDevice requires profile data when RTS is enabled", () => {
    expect(() => eraseDevice({ commandUuid: "u", rtsEnabled: true })).toThrow(TypeError);
  });

  test("installApplication", () => {
    expect(
      installApplication({ commandUuid: "u", manifestUrl: "https://example.com/manifest" }),
    ).toEqual({
      CommandUUID: "u",
      Command: { RequestType: "InstallApplication", ManifestURL: "https://example.com/manifest" },
    });
  });

  test("installProfile embeds raw bytes", () => {
    const payload = installProfile({ commandUuid: "u", rawProfile: "RAW" });
    expect(payload.Command.RequestType).toBe("InstallProfile");
    expect((payload.Command.Payload as Buffer).toString()).toBe("RAW");
  });

  test("installProfileTemplate wraps the sample profile", () => {
    const payload = installProfileTemplate({ commandUuid: "u", profileUuid: "p-1" });
    expect(payload.CommandUUID).toBe("u");
    const raw = (payload.Command.Payload as Buffer).toString();
    expect(raw).toContain("oreoremdm.p-1");
    expect(raw).toContain("forceDelaySoftwareUpdate90");
  });

  test("installedApplicationList", () => {
    const payload = installedApplicationList({ commandUuid: "u" });
    expect(payload.Command).toEqual({
      Items: [
        "BundleSize",
        "DynamicSize",
        "ExternalVersionIdentifier",
        "HasUpdateAvailable",
        "Identifier",
        "Installing",
        "Name",
        "ShortVersion",
        "Version",
      ],
      ManagedAppsOnly: false,
      RequestType: "InstalledApplicationList",
    });
    expect(Object.keys(payload.Command)).toEqual(["Items", "ManagedAppsOnly", "RequestType"]);
    expect(installedApplicationList({ managedAppsOnly: true }).Command.ManagedAppsOnly).toBe(true);
  });

  test("removeProfile and template", () => {
    expect(removeProfile({ commandUuid: "u", identifier: "com.example.x" })).toEqual({
      CommandUUID: "u",
      Command: { RequestType: "RemoveProfile", Identifier: "com.example.x" },
    });
    const templated = removeProfileTemplate({ commandUuid: "u", profileUuid: "p-1" });
    expect(templated.Command.Identifier).toBe("oreoremdm.p-1");
    expect(removeProfileTemplate().Command.Identifier).toMatch(/^oreoremdm\.[0-9a-f-]{36}$/);
  });

  test("declarativeManagement embeds tokens JSON bytes", () => {
    const tokens = { SyncTokens: { DeclarationsToken: "abc" } };
    const payload = declarativeManagement({ commandUuid: "u", tokens });
    expect(payload.Command.RequestType).toBe("DeclarativeManagement");
    expect((payload.Command.Data as Buffer).toString()).toBe(JSON.stringify(tokens));
  });

  test("command UUID defaults to a random UUID", () => {
    expect(deviceInformation().CommandUUID).toMatch(/^[0-9a-f-]{36}$/);
    expect(deviceInformation().CommandUUID).not.toBe(deviceInformation().CommandUUID);
  });
});
