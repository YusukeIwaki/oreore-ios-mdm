import { describe, expect, test } from "bun:test";
import {
  collectRequiredResourceIdentifiers,
  collectResourceIdentifiers,
  InsufficientResourceIdentifiers,
  isResourceReference,
  replaceResourceIdentifiers,
  resolvedPayload,
  resourceIdentifier,
  uuidv5,
} from "../../src/ddm/identifiers";

describe("resource identifiers", () => {
  test("uuidv5 matches RFC 4122 vectors", () => {
    expect(uuidv5("@configuration/wifi_office_profile")).toBe(
      "1fb18ab5-63b7-5a66-a703-f98f3dde8427",
    );
    expect(uuidv5("@asset/group1_member_gmail")).toBe("68f7188f-3793-5507-9597-85326c71b964");
    expect(uuidv5("@activation/apply_wifi_office_profile")).toBe(
      "4711ea90-918f-5163-b921-753616085054",
    );
  });

  test("resourceIdentifier builds reference names and digests", () => {
    expect(resourceIdentifier("configuration", "wifi_office_profile")).toEqual({
      basename: "wifi_office_profile",
      referenceName: "@configuration/wifi_office_profile",
      digest: "1fb18ab5-63b7-5a66-a703-f98f3dde8427",
    });
  });

  test("isResourceReference matches the Ruby syntax exactly", () => {
    expect(isResourceReference("@asset/test1")).toBe(true);
    expect(isResourceReference("@public/wifi_EAPTest")).toBe(true);
    expect(isResourceReference("@configuration/a.b_c-d9")).toBe(true);
    expect(isResourceReference("@Asset/test1")).toBe(false);
    expect(isResourceReference("@asset/")).toBe(false);
    expect(isResourceReference("@/test1")).toBe(false);
    expect(isResourceReference("123@public/test12")).toBe(false);
    expect(isResourceReference("@asset/test1\n")).toBe(false);
    expect(isResourceReference("@asset/test 1")).toBe(false);
    expect(isResourceReference(42)).toBe(false);
    expect(isResourceReference(null)).toBe(false);
  });

  test("collects required identifiers, skipping keys and partial matches", () => {
    const payload = {
      Echo: "test",
      AssetReference: "@asset/test1",
      AssetReferenceDeep: {
        "@asset/test123": "test",
        Deep: [{ key: "@asset/test12" }],
      },
    };
    expect(
      collectRequiredResourceIdentifiers(payload, [
        "@asset/test",
        "@asset/test1",
        "@asset/test12",
        "@asset/test123",
      ]).sort(),
    ).toEqual(["@asset/test1", "@asset/test12"]);
    expect(collectRequiredResourceIdentifiers(payload, ["@asset/test"])).toEqual([]);
    // Dedup: the same reference twice is collected once.
    expect(collectResourceIdentifiers({ a: "@asset/x", b: ["@asset/x"] })).toEqual(["@asset/x"]);
  });

  test("resolves references, leaving keys and partial matches alone", () => {
    const payload = {
      ProfileURL: "@public/test1",
      "@public/test": "test",
      test: "123@public/test12",
      Deep: [{ key: "@public/test12" }],
    };
    const map = {
      "@public/test1": "https://example.com/test1",
      "@public/test12": "https://example.com/test12",
      "@public/test123": "https://example.com/test123",
    };
    expect(resolvedPayload(payload, map)).toEqual({
      ProfileURL: "https://example.com/test1",
      "@public/test": "test",
      test: "123@public/test12",
      Deep: [{ key: "https://example.com/test12" }],
    });
  });

  test("raises InsufficientResourceIdentifiers with the missing references", () => {
    const payload = {
      ProfileURL: "@public/test1",
      Deep: [{ key: "@public/test12" }],
    };
    let error: unknown;
    try {
      resolvedPayload(payload, { "@public/test1": "https://example.com/test1" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InsufficientResourceIdentifiers);
    expect((error as Error).message).toBe("Required resource_identifiers: [@public/test12]");
  });

  test("replaceResourceIdentifiers maps missing keys to null", () => {
    expect(replaceResourceIdentifiers({ a: "@asset/x" }, {})).toEqual({ a: null });
  });
});
