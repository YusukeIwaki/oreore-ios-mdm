import { describe, expect, test } from "bun:test";
import {
  Declaration,
  DeclarationItem,
  formatJstTimestamp,
  sha256Hex,
} from "../../src/ddm/declaration";
import { resourceIdentifier } from "../../src/ddm/identifiers";

const INPUT = {
  activations: [
    {
      name: "apply_wifi_office_profile",
      type: "com.apple.activation.simple",
      payload: {
        Predicate: "@status(device.model.family) == 'iPhone'",
        StandardConfigurations: ["@configuration/wifi_office_profile"],
      },
    },
  ],
  configurations: [
    {
      name: "wifi_office_profile",
      type: "com.apple.configuration.legacy",
      payload: { ProfileURL: "@public/wifi_office" },
    },
    {
      name: "unused_profile",
      type: "com.apple.configuration.legacy",
      payload: { ProfileURL: "@public/unused" },
    },
  ],
  assets: [{ name: "group1_member_gmail" }],
  assetDetails: [
    {
      assetName: "group1_member_gmail",
      assetType: "com.apple.asset.useridentity",
      payload: { EmailAddress: "user@gmail.com" },
    },
  ],
  managementDetails: [
    {
      managementName: "age",
      managementType: "com.apple.management.properties",
      payload: { age: 23 },
    },
  ],
  publicAssetDetails: [{ assetName: "wifi_office", accessUrl: "https://mdm.example.com/files/1" }],
};

describe("declaration", () => {
  test("sha256Hex matches Ruby Digest::SHA256", () => {
    expect(
      sha256Hex(
        JSON.stringify({
          Type: "com.apple.configuration.legacy",
          Payload: { ProfileURL: "https://example.com/x" },
        }),
      ),
    ).toBe("5d3895f5de5ad555948930fd39af03eb6e82ce4fb413cf2d30bf6af8addbe9fa");
  });

  test("DeclarationItem manifest/detail/serverToken", () => {
    const item = new DeclarationItem({
      identifier: "identifier-1",
      type: "com.apple.configuration.legacy",
      payload: { ProfileURL: "https://example.com/x" },
    });
    expect(item.serverToken()).toBe("5d3895f5de5ad555948930fd39af03eb6e82ce4fb413cf2d30bf6af8addbe9fa");
    expect(item.manifest()).toEqual({
      Identifier: "identifier-1",
      ServerToken: item.serverToken(),
    });
    expect(Object.keys(item.manifest())).toEqual(["Identifier", "ServerToken"]);
    expect(item.detail()).toEqual({
      Identifier: "identifier-1",
      Type: "com.apple.configuration.legacy",
      Payload: { ProfileURL: "https://example.com/x" },
      ServerToken: item.serverToken(),
    });
    expect(item.hasIdentifier("identifier-1")).toBe(true);
    expect(item.hasIdentifier("other")).toBe(false);
  });

  test("formatJstTimestamp uses +09:00 with second precision", () => {
    expect(formatJstTimestamp(new Date("2024-01-02T00:00:00Z"))).toBe("2024-01-02T09:00:00+09:00");
    expect(formatJstTimestamp(new Date("2024-01-01T16:00:00Z"))).toBe("2024-01-02T01:00:00+09:00");
  });

  test("Declaration resolves references and filters unreferenced rows", () => {
    const declaration = new Declaration(INPUT);
    const items = declaration.declarationItems();

    expect(items.Declarations.Activations).toHaveLength(1);
    // Only the referenced configuration is included.
    expect(items.Declarations.Configurations).toHaveLength(1);
    // The asset is unreferenced by the included configuration.
    expect(items.Declarations.Assets).toHaveLength(0);
    expect(items.Declarations.Management).toHaveLength(1);

    const configurationId = resourceIdentifier("configuration", "wifi_office_profile").digest;
    const activation = declaration.activationDetailFor(
      resourceIdentifier("activation", "apply_wifi_office_profile").digest,
    )!;
    expect(activation.Payload).toEqual({
      Predicate: "@status(device.model.family) == 'iPhone'",
      StandardConfigurations: [configurationId],
    });

    const configuration = declaration.configurationDetailFor(configurationId)!;
    expect(configuration.Payload).toEqual({ ProfileURL: "https://mdm.example.com/files/1" });

    // Management payloads are used raw, with `property` digests for properties.
    const management = declaration.managementDetailFor(
      resourceIdentifier("property", "age").digest,
    )!;
    expect(management.Payload).toEqual({ age: 23 });

    expect(declaration.activationDetailFor("missing")).toBeUndefined();
  });

  test("tokens share the DeclarationsToken with declarationItems", () => {
    const declaration = new Declaration(INPUT);
    const now = new Date("2024-06-01T12:34:56Z");
    const tokens = declaration.tokens(now);
    expect(tokens).toEqual({
      SyncTokens: {
        DeclarationsToken: declaration.declarationItems().DeclarationsToken,
        Timestamp: "2024-06-01T21:34:56+09:00",
      },
    });
    // Deterministic for the same input.
    expect(new Declaration(INPUT).tokens(now)).toEqual(tokens);
  });
});
