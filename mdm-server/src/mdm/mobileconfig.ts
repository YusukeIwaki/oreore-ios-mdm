import { randomUUID } from "node:crypto";

/**
 * Enrollment profile builders (ported from `models/mobile_config/*.rb` and
 * `views/*.mobileconfig.rb`). Key order matches the Ruby hashes.
 */

export interface ProfileContent {
  buildPayload(): Record<string, unknown>;
}

export function rootProfile(options: {
  uuid?: string;
  displayName?: string;
  contents: ProfileContent[];
}): Record<string, unknown> {
  const { uuid = randomUUID(), displayName = "Untitled", contents } = options;
  if (
    !Array.isArray(contents) ||
    contents.some((content) => typeof content?.buildPayload !== "function")
  ) {
    throw new TypeError("contents must be an array of profile contents");
  }
  return {
    PayloadContent: contents.map((content) => content.buildPayload()),
    PayloadDisplayName: displayName,
    PayloadIdentifier: `dev.oreore-mdm.${uuid}`,
    PayloadRemovalDisallowed: false,
    PayloadType: "Configuration",
    PayloadUUID: uuid,
    PayloadVersion: 1,
  };
}

export function securityPkcs12(options: {
  uuid?: string;
  p12Der: Uint8Array;
  filename: string;
  password: string;
}): Record<string, unknown> & { uuid: string } {
  const { uuid = randomUUID(), p12Der, filename, password } = options;
  if (typeof filename !== "string") {
    throw new TypeError("filename must be a String");
  }
  if (typeof password !== "string") {
    throw new TypeError("password must be a String");
  }
  return {
    uuid,
    Password: password,
    PayloadCertificateFileName: filename,
    PayloadContent: Buffer.from(p12Der),
    PayloadDescription: "Certificate (PKCS #12)",
    PayloadDisplayName: filename,
    PayloadIdentifier: `com.apple.security.pkcs12.${uuid}`,
    PayloadType: "com.apple.security.pkcs12",
    PayloadUUID: uuid,
    PayloadVersion: 1,
  };
}

export function serverCapabilities(hasGetTokenTarget: boolean): string[] {
  if (hasGetTokenTarget) {
    return ["com.apple.mdm.per-user-connections", "com.apple.mdm.token"];
  }
  return ["com.apple.mdm.per-user-connections"];
}

function checkTopic(topic: unknown): asserts topic is string {
  if (typeof topic !== "string" || !topic.startsWith("com.apple.mgmt.External.")) {
    throw new TypeError("topic must be a String starting with com.apple.mgmt.External.");
  }
}

export function mdmPayload(options: {
  uuid?: string;
  identityCertificateUuid: string;
  topic: string;
  baseUrl: string;
  hasGetTokenTarget: boolean;
}): Record<string, unknown> {
  const { uuid = randomUUID() } = options;
  checkTopic(options.topic);
  return {
    IdentityCertificateUUID: options.identityCertificateUuid,
    Topic: options.topic,
    ServerURL: `${options.baseUrl}/mdm/command`,
    ServerCapabilities: serverCapabilities(options.hasGetTokenTarget),
    CheckInURL: `${options.baseUrl}/mdm/checkin`,
    CheckOutWhenRemoved: true,
    AccessRights: 8191,
    PayloadDescription: "Configures Mobile Device Management",
    PayloadDisplayName: "Oreore MDM",
    PayloadIdentifier: `com.apple.mdm.${uuid}`,
    PayloadType: "com.apple.mdm",
    PayloadUUID: uuid,
    PayloadVersion: 1,
  };
}

export function mdmAddePayload(
  options: Parameters<typeof mdmPayload>[0] & { assignedManagedAppleId: string },
): Record<string, unknown> {
  const { uuid = randomUUID() } = options;
  checkTopic(options.topic);
  if (typeof options.assignedManagedAppleId !== "string") {
    throw new TypeError("assignedManagedAppleId must be a String");
  }
  return {
    IdentityCertificateUUID: options.identityCertificateUuid,
    Topic: options.topic,
    ServerURL: `${options.baseUrl}/mdm-adde/command`,
    ServerCapabilities: serverCapabilities(options.hasGetTokenTarget),
    CheckInURL: `${options.baseUrl}/mdm-adde/checkin`,
    CheckOutWhenRemoved: true,
    AccessRights: 8191,
    AssignedManagedAppleID: options.assignedManagedAppleId,
    EnrollmentMode: "ADDE",
    PayloadDescription: "Configures Mobile Device Management",
    PayloadDisplayName: "Oreore MDM",
    PayloadIdentifier: `com.apple.mdm.${uuid}`,
    PayloadType: "com.apple.mdm",
    PayloadUUID: uuid,
    PayloadVersion: 1,
  };
}

export function mdmByodPayload(
  options: Parameters<typeof mdmPayload>[0] & { assignedManagedAppleId: string },
): Record<string, unknown> {
  const { uuid = randomUUID() } = options;
  checkTopic(options.topic);
  if (typeof options.assignedManagedAppleId !== "string") {
    throw new TypeError("assignedManagedAppleId must be a String");
  }
  return {
    IdentityCertificateUUID: options.identityCertificateUuid,
    Topic: options.topic,
    ServerURL: `${options.baseUrl}/mdm-byod/command`,
    ServerCapabilities: serverCapabilities(options.hasGetTokenTarget),
    CheckInURL: `${options.baseUrl}/mdm-byod/checkin`,
    CheckOutWhenRemoved: true,
    // NOTE: no AccessRights — BYOD enrollment forbids it.
    AssignedManagedAppleID: options.assignedManagedAppleId,
    EnrollmentMode: "BYOD",
    PayloadDescription: "Configures Mobile Device Management",
    PayloadDisplayName: "Oreore MDM",
    PayloadIdentifier: `com.apple.mdm.${uuid}`,
    PayloadType: "com.apple.mdm",
    PayloadUUID: uuid,
    PayloadVersion: 1,
  };
}

export interface EnrollmentProfileOptions {
  payloadUuid: string;
  topic: string;
  deviceP12Der: Uint8Array;
  baseUrl: string;
  hasGetTokenTarget: boolean;
  identityUuid?: string;
}

function enrollmentContents(
  options: EnrollmentProfileOptions,
  mdm: (identityUuid: string) => Record<string, unknown>,
): Record<string, unknown> {
  const identityUuid = options.identityUuid ?? randomUUID();
  const identity = securityPkcs12({
    uuid: identityUuid,
    p12Der: options.deviceP12Der,
    filename: "oreore-mdm-device.p12",
    password: "!oreore-mdm",
  });
  const { uuid: _ignored, ...identityPayload } = identity;
  void _ignored;
  return rootProfile({
    uuid: options.payloadUuid,
    displayName: "Oreore MDM configuration",
    contents: [{ buildPayload: () => identityPayload }, { buildPayload: () => mdm(identityUuid) }],
  });
}

/** `GET /mdm.mobileconfig` (+ Apple Configurator / DEP enroll variants). */
export function mdmEnrollmentProfile(options: EnrollmentProfileOptions): Record<string, unknown> {
  return enrollmentContents(options, (identityUuid) =>
    mdmPayload({
      uuid: `${options.payloadUuid}.mdm`,
      identityCertificateUuid: identityUuid,
      topic: options.topic,
      baseUrl: options.baseUrl,
      hasGetTokenTarget: options.hasGetTokenTarget,
    }),
  );
}

/** `POST /mdm-adde/enroll`. */
export function mdmAddeEnrollmentProfile(
  options: EnrollmentProfileOptions & { assignedManagedAppleId: string },
): Record<string, unknown> {
  return enrollmentContents(options, (identityUuid) =>
    mdmAddePayload({
      uuid: `${options.payloadUuid}.mdm`,
      identityCertificateUuid: identityUuid,
      topic: options.topic,
      baseUrl: options.baseUrl,
      hasGetTokenTarget: options.hasGetTokenTarget,
      assignedManagedAppleId: options.assignedManagedAppleId,
    }),
  );
}

/** `POST /mdm-byod/enroll`. */
export function mdmByodEnrollmentProfile(
  options: EnrollmentProfileOptions & { assignedManagedAppleId: string },
): Record<string, unknown> {
  return enrollmentContents(options, (identityUuid) =>
    mdmByodPayload({
      uuid: `${options.payloadUuid}.mdm`,
      identityCertificateUuid: identityUuid,
      topic: options.topic,
      baseUrl: options.baseUrl,
      hasGetTokenTarget: options.hasGetTokenTarget,
      assignedManagedAppleId: options.assignedManagedAppleId,
    }),
  );
}
