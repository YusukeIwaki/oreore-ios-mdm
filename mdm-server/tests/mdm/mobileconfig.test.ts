import { describe, expect, test } from "bun:test";
import {
  mdmAddeEnrollmentProfile,
  mdmAddePayload,
  mdmByodEnrollmentProfile,
  mdmByodPayload,
  mdmEnrollmentProfile,
  mdmPayload,
  rootProfile,
  securityPkcs12,
  serverCapabilities,
  type EnrollmentProfileOptions,
} from "../../src/mdm/mobileconfig";
import { buildPlist, parsePlist } from "../../src/mdm/plist";

const TOPIC = "com.apple.mgmt.External.test-topic";
const BASE_OPTIONS: EnrollmentProfileOptions = {
  payloadUuid: "payload-uuid-1",
  topic: TOPIC,
  deviceP12Der: new Uint8Array([0x30, 0x82, 0x01]),
  baseUrl: "https://mdm.example.com",
  hasGetTokenTarget: true,
  identityUuid: "identity-uuid-1",
};

describe("mobileconfig", () => {
  test("rootProfile uses defaults and preserves content order", () => {
    const payload = rootProfile({
      displayName: "test",
      contents: [
        { buildPayload: () => ({ id: 10 }) },
        { buildPayload: () => ({ id: 1 }) },
      ],
    });
    expect(payload.PayloadContent).toEqual([{ id: 10 }, { id: 1 }]);
    expect(payload.PayloadUUID).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload.PayloadIdentifier).toBe(`dev.oreore-mdm.${payload.PayloadUUID}`);
    expect(payload.PayloadDisplayName).toBe("test");
    expect(rootProfile({ contents: [] }).PayloadDisplayName).toBe("Untitled");
    expect(rootProfile({ uuid: "uuid", displayName: "t", contents: [] }).PayloadUUID).toBe("uuid");
  });

  test("rootProfile rejects invalid contents", () => {
    expect(() => rootProfile({ contents: [{}] as never })).toThrow(TypeError);
  });

  test("securityPkcs12 embeds DER bytes", () => {
    const payload = securityPkcs12({
      uuid: "pkcs12-uuid",
      p12Der: new Uint8Array([1, 2, 3]),
      filename: "id.p12",
      password: "secret",
    });
    expect([...(payload.PayloadContent as Buffer)]).toEqual([1, 2, 3]);
    expect(Object.keys(payload).filter((key) => key !== "uuid")).toEqual([
      "Password",
      "PayloadCertificateFileName",
      "PayloadContent",
      "PayloadDescription",
      "PayloadDisplayName",
      "PayloadIdentifier",
      "PayloadType",
      "PayloadUUID",
      "PayloadVersion",
    ]);
    expect(() => securityPkcs12({ p12Der: new Uint8Array(), filename: 1 as never, password: "p" })).toThrow(
      TypeError,
    );
  });

  test("serverCapabilities", () => {
    expect(serverCapabilities(true)).toEqual([
      "com.apple.mdm.per-user-connections",
      "com.apple.mdm.token",
    ]);
    expect(serverCapabilities(false)).toEqual(["com.apple.mdm.per-user-connections"]);
  });

  test("mdmPayload", () => {
    const payload = mdmPayload({
      uuid: "mdm-uuid",
      identityCertificateUuid: "identity-uuid",
      topic: TOPIC,
      baseUrl: "https://mdm.example.com",
      hasGetTokenTarget: false,
    });
    expect(payload).toEqual({
      IdentityCertificateUUID: "identity-uuid",
      Topic: TOPIC,
      ServerURL: "https://mdm.example.com/mdm/command",
      ServerCapabilities: ["com.apple.mdm.per-user-connections"],
      CheckInURL: "https://mdm.example.com/mdm/checkin",
      CheckOutWhenRemoved: true,
      AccessRights: 8191,
      PayloadDescription: "Configures Mobile Device Management",
      PayloadDisplayName: "Oreore MDM",
      PayloadIdentifier: "com.apple.mdm.mdm-uuid",
      PayloadType: "com.apple.mdm",
      PayloadUUID: "mdm-uuid",
      PayloadVersion: 1,
    });
  });

  test("payloads reject bad topics", () => {
    const options = {
      identityCertificateUuid: "i",
      baseUrl: "https://mdm.example.com",
      hasGetTokenTarget: false,
    };
    expect(() => mdmPayload({ ...options, topic: "invalid" })).toThrow(TypeError);
    expect(() =>
      mdmAddePayload({ ...options, topic: TOPIC, assignedManagedAppleId: "a@b.c" }),
    ).not.toThrow();
    expect(() =>
      mdmByodPayload({ ...options, topic: TOPIC, assignedManagedAppleId: 1 as never }),
    ).toThrow(TypeError);
  });

  test("adde payload keeps AccessRights, byod payload omits it", () => {
    const adde = mdmAddePayload({
      uuid: "u",
      identityCertificateUuid: "i",
      topic: TOPIC,
      baseUrl: "https://mdm.example.com",
      hasGetTokenTarget: true,
      assignedManagedAppleId: "user@example.com",
    });
    expect(adde.AccessRights).toBe(8191);
    expect(adde.EnrollmentMode).toBe("ADDE");
    expect(adde.ServerURL).toBe("https://mdm.example.com/mdm-adde/command");

    const byod = mdmByodPayload({
      uuid: "u",
      identityCertificateUuid: "i",
      topic: TOPIC,
      baseUrl: "https://mdm.example.com",
      hasGetTokenTarget: true,
      assignedManagedAppleId: "user@example.com",
    });
    expect("AccessRights" in byod).toBe(false);
    expect(byod.EnrollmentMode).toBe("BYOD");
    expect(byod.ServerURL).toBe("https://mdm.example.com/mdm-byod/command");
  });

  test("mdmEnrollmentProfile links identity and MDM payloads", () => {
    const profile = mdmEnrollmentProfile(BASE_OPTIONS);
    const contents = profile.PayloadContent as Array<Record<string, unknown>>;
    expect(contents).toHaveLength(2);
    expect(profile.PayloadUUID).toBe("payload-uuid-1");
    expect(contents[1]!.PayloadUUID).toBe("payload-uuid-1.mdm");
    expect(contents[1]!.IdentityCertificateUUID).toBe("identity-uuid-1");
    expect(contents[0]!.PayloadUUID).toBe("identity-uuid-1");

    const roundTripped = parsePlist(buildPlist(profile)) as Record<string, unknown>;
    expect(roundTripped.PayloadType).toBe("Configuration");
  });

  test("adde/byod enrollment profiles carry the managed Apple ID", () => {
    for (const build of [mdmAddeEnrollmentProfile, mdmByodEnrollmentProfile]) {
      const profile = build({ ...BASE_OPTIONS, assignedManagedAppleId: "user@example.com" });
      const contents = profile.PayloadContent as Array<Record<string, unknown>>;
      expect(contents[1]!.AssignedManagedAppleID).toBe("user@example.com");
    }
  });
});
