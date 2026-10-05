import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  buildInstallProfileTemplate,
  declarativeManagement,
  deviceInformation,
  installProfile,
} from "../../src/mdm/commands";
import { buildPlist, dataToBuffer, parsePlist } from "../../src/mdm/plist";

const fixtures = join(import.meta.dir, "..", "fixtures");
const readFixture = (name: string): string => readFileSync(join(fixtures, name), "utf8");

describe("plist", () => {
  test("round-trips command payloads through XML", () => {
    const payload = deviceInformation({ commandUuid: "uuid-1" });
    const parsed = parsePlist(buildPlist(payload)) as Record<string, unknown>;
    expect(parsed).toEqual(JSON.parse(JSON.stringify(payload)));
  });

  test("round-trips <data> bytes", () => {
    const payload = installProfile({ commandUuid: "u", rawProfile: "RAW-PROFILE-BYTES" });
    const parsed = parsePlist(buildPlist(payload)) as {
      Command: { Payload: unknown };
    };
    expect(dataToBuffer(parsed.Command.Payload).toString()).toBe("RAW-PROFILE-BYTES");

    const tokens = { SyncTokens: { DeclarationsToken: "abc" } };
    const dm = parsePlist(
      buildPlist(declarativeManagement({ commandUuid: "u", tokens })),
    ) as { Command: { Data: unknown } };
    expect(dataToBuffer(dm.Command.Data).toString()).toBe(JSON.stringify(tokens));
  });

  test("parses Ruby-generated device_information.plist", () => {
    const parsed = parsePlist(readFixture("device_information.plist")) as Record<string, unknown>;
    expect(parsed).toEqual({
      CommandUUID: "uuid-device-information",
      Command: {
        RequestType: "DeviceInformation",
        Queries: ["UDID", "OrganizationInfo", "AwaitingConfiguration"],
      },
    });
  });

  test("parses Ruby-generated install_profile.plist with <data>", () => {
    const parsed = parsePlist(readFixture("install_profile.plist")) as {
      CommandUUID: unknown;
      Command: { RequestType: unknown; Payload: unknown };
    };
    expect(parsed.CommandUUID).toBe("uuid-install-profile");
    expect(parsed.Command.RequestType).toBe("InstallProfile");
    expect(dataToBuffer(parsed.Command.Payload).toString()).toBe("RAW-PROFILE-BYTES");
  });

  test("parses Ruby-generated declarative_management.plist", () => {
    const parsed = parsePlist(readFixture("declarative_management.plist")) as {
      Command: { RequestType: unknown; Data: unknown };
    };
    expect(parsed.Command.RequestType).toBe("DeclarativeManagement");
    expect(JSON.parse(dataToBuffer(parsed.Command.Data).toString())).toEqual({
      SyncTokens: { DeclarationsToken: "abc", Timestamp: "2024-01-01T00:00:00+09:00" },
    });
  });

  test("sample InstallProfile template is byte-identical to the Ruby heredoc", () => {
    const rubyTemplate = readFixture("install_profile_template.plist");
    const profileUuid = rubyTemplate.match(/oreoremdm\.([^<]+)/)?.[1];
    expect(profileUuid).toBeDefined();
    expect(buildInstallProfileTemplate({ profileUuid: profileUuid! })).toBe(rubyTemplate);
  });
});
