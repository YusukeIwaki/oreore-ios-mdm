import {
  bigserial,
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Schema ported 1:1 from the root `Schemafile` (Ridgepole).
 * Table, column, and index names are kept identical so existing data stays
 * portable between the Ruby and Bun servers.
 */

const timestamps = {
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
};

const createdAtOnly = {
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
};

export const pendingCheckins = pgTable(
  "pending_checkins",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    udid: varchar("udid", { length: 255 }).notNull(),
    serialNumber: varchar("serial_number", { length: 255 }).notNull(),
    imei: varchar("imei", { length: 255 }),
    ...timestamps,
  },
  (t) => [uniqueIndex("index_pending_checkins_udid").on(t.udid)],
);

export const mdmDevices = pgTable(
  "mdm_devices",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    udid: varchar("udid", { length: 255 }).notNull(),
    serialNumber: varchar("serial_number", { length: 255 }).notNull(),
    imei: varchar("imei", { length: 255 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("index_mdm_devices_udid").on(t.udid),
    uniqueIndex("index_mdm_devices_serial_number").on(t.serialNumber),
  ],
);

export const mdmPushEndpoints = pgTable(
  "mdm_push_endpoints",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    mdmDeviceId: bigint("mdm_device_id", { mode: "number" }).notNull(),
    token: varchar("token", { length: 255 }).notNull(),
    pushMagic: varchar("push_magic", { length: 255 }).notNull(),
    unlockToken: text("unlock_token"),
    ...timestamps,
  },
  (t) => [uniqueIndex("index_mdm_push_tokens_mdm_device_id").on(t.mdmDeviceId)],
);

export const mdmCommandRequests = pgTable(
  "mdm_command_requests",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deviceIdentifier: varchar("device_identifier", { length: 255 }).notNull(),
    requestPayload: text("request_payload").notNull(),
    ...createdAtOnly,
  },
  (t) => [index("index_mdm_command_requests_device_identifier").on(t.deviceIdentifier)],
);

export const mdmCommandHandlingRequests = pgTable(
  "mdm_command_handling_requests",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deviceIdentifier: varchar("device_identifier", { length: 255 }).notNull(),
    commandUuid: varchar("command_uuid", { length: 255 }).notNull(),
    requestPayload: text("request_payload").notNull(),
    ...createdAtOnly,
  },
  (t) => [
    uniqueIndex("index_mdm_command_handling_requests_device_identifier_command").on(
      t.deviceIdentifier,
      t.commandUuid,
    ),
  ],
);

export const mdmCommandHistories = pgTable(
  "mdm_command_histories",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deviceIdentifier: varchar("device_identifier", { length: 255 }).notNull(),
    requestType: varchar("request_type", { length: 255 }).notNull(),
    commandUuid: varchar("command_uuid", { length: 255 }).notNull(),
    requestPayload: text("request_payload").notNull(),
    responsePayload: text("response_payload").notNull(),
    ...createdAtOnly,
  },
  (t) => [
    uniqueIndex("index_command_histories_device_identifier_command_uuid").on(
      t.deviceIdentifier,
      t.commandUuid,
    ),
    index("index_command_histories_created_at").on(t.createdAt),
  ],
);

export const rtsWifiProfiles = pgTable(
  "rts_wifi_profiles",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    assetFileData: text("asset_file_data").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("index_rts_wifi_profiles_name").on(t.name)],
);

export const vppContentTokens = pgTable(
  "vpp_content_tokens",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    filename: varchar("filename", { length: 255 }).notNull(),
    value: varchar("value", { length: 255 }).notNull(),
    expDate: timestamp("exp_date", { mode: "date" }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("index_vpp_content_tokens_filename").on(t.filename)],
);

export const ipaFiles = pgTable(
  "ipa_files",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    filename: varchar("filename", { length: 255 }).notNull(),
    bundleIdentifier: varchar("bundle_identifier", { length: 255 }).notNull(),
    assetFileData: text("asset_file_data").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("index_ipa_files_filename").on(t.filename)],
);

export const depServerTokens = pgTable(
  "dep_server_tokens",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    filename: varchar("filename", { length: 255 }).notNull(),
    rawPayload: text("raw_payload"),
    consumerKey: varchar("consumer_key", { length: 255 }).notNull(),
    consumerSecret: varchar("consumer_secret", { length: 255 }).notNull(),
    accessToken: varchar("access_token", { length: 255 }).notNull(),
    accessSecret: varchar("access_secret", { length: 255 }).notNull(),
    accessTokenExpiry: timestamp("access_token_expiry", { mode: "date" }).notNull(),
  },
  (t) => [uniqueIndex("index_dep_server_tokens_filename").on(t.filename)],
);

export const getTokenTargets = pgTable("get_token_targets", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  depServerTokenId: bigint("dep_server_token_id", { mode: "number" }).notNull(),
  serverUuid: varchar("server_uuid", { length: 255 }).notNull(),
  ...timestamps,
});

export const getTokenHistories = pgTable(
  "get_token_histories",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    iat: timestamp("iat", { mode: "date" }).notNull(),
    jti: varchar("jti", { length: 255 }).notNull(),
    serviceType: varchar("service_type", { length: 255 }).notNull(),
    deviceIdentifier: varchar("device_identifier", { length: 255 }).notNull(),
    jwt: text("jwt"),
  },
  (t) => [
    uniqueIndex("index_get_token_histories_jti").on(t.jti),
    index("index_get_token_histories_device_service_iat").on(
      t.deviceIdentifier,
      t.serviceType,
      t.iat,
    ),
  ],
);

export const ddmDeviceGroups = pgTable(
  "ddm_device_groups",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("index_ddm_device_groups_name").on(t.name)],
);

export const ddmDeviceGroupItems = pgTable(
  "ddm_device_group_items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ddmDeviceGroupId: bigint("ddm_device_group_id", { mode: "number" }).notNull(),
    deviceIdentifier: varchar("device_identifier", { length: 255 }).notNull(),
    ...createdAtOnly,
  },
  (t) => [
    uniqueIndex("index_ddm_device_group_item_device_identifier").on(
      t.deviceIdentifier,
      t.ddmDeviceGroupId,
    ),
    index("index_ddm_device_group_item_ddm_device_group").on(t.ddmDeviceGroupId),
  ],
);

export const ddmActivations = pgTable(
  "ddm_activations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    type: varchar("type", { length: 255 }).notNull(),
    payload: text("payload").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("index_ddm_activation_name").on(t.name)],
);

export const ddmActivationTargets = pgTable(
  "ddm_activation_targets",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ddmActivationId: bigint("ddm_activation_id", { mode: "number" }).notNull(),
    // NULL means the activation applies to all devices.
    targetIdentifier: varchar("target_identifier", { length: 255 }),
    ...createdAtOnly,
  },
  (t) => [
    uniqueIndex("index_ddm_activation_target_identifier").on(
      t.targetIdentifier,
      t.ddmActivationId,
    ),
    index("index_ddm_activation_target_ddm_activation_id").on(t.ddmActivationId),
  ],
);

export const ddmConfigurations = pgTable(
  "ddm_configurations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    type: varchar("type", { length: 255 }).notNull(),
    payload: text("payload").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("index_ddm_configuration_name").on(t.name)],
);

export const ddmAssets = pgTable(
  "ddm_assets",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    type: varchar("type", { length: 255 }).notNull(),
    ...createdAtOnly,
  },
  (t) => [uniqueIndex("index_ddm_asset_name").on(t.name)],
);

export const ddmAssetDetails = pgTable(
  "ddm_asset_details",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ddmAssetId: bigint("ddm_asset_id", { mode: "number" }).notNull(),
    // NULL means the detail applies by default.
    targetIdentifier: varchar("target_identifier", { length: 255 }),
    payload: text("payload").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("index_ddm_asset_detail_target_identifier").on(
      t.targetIdentifier,
      t.ddmAssetId,
    ),
    index("index_ddm_asset_detail_ddm_asset_id").on(t.ddmAssetId),
  ],
);

export const ddmManagements = pgTable(
  "ddm_managements",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    type: varchar("type", { length: 255 }).notNull(),
    ...createdAtOnly,
  },
  (t) => [uniqueIndex("index_management_name").on(t.name)],
);

export const ddmManagementDetails = pgTable(
  "ddm_management_details",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ddmManagementId: bigint("ddm_management_id", { mode: "number" }).notNull(),
    // NULL means the detail applies by default.
    targetIdentifier: varchar("target_identifier", { length: 255 }),
    payload: text("payload").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("index_ddm_management_detail_target_identifier").on(
      t.targetIdentifier,
      t.ddmManagementId,
    ),
    index("index_ddm_management_detail_ddm_management_id").on(t.ddmManagementId),
  ],
);

export const ddmPublicAssets = pgTable(
  "ddm_public_assets",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("index_ddm_public_asset_name").on(t.name)],
);

export const ddmPublicAssetDetails = pgTable(
  "ddm_public_asset_details",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ddmPublicAssetId: bigint("ddm_public_asset_id", { mode: "number" }).notNull(),
    // NULL means the detail applies by default.
    targetIdentifier: varchar("target_identifier", { length: 255 }),
    assetFileData: text("asset_file_data").notNull(),
    ...createdAtOnly,
  },
  (t) => [
    uniqueIndex("index_ddm_public_asset_detail_target_identifier").on(
      t.targetIdentifier,
      t.ddmPublicAssetId,
    ),
    index("index_ddm_public_asset_detail_ddm_public_asset_id").on(t.ddmPublicAssetId),
  ],
);

export const ddmSynchronizationRequestHistories = pgTable(
  "ddm_synchronization_request_histories",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deviceIdentifier: varchar("device_identifier", { length: 255 }).notNull(),
    endpoint: varchar("endpoint", { length: 255 }).notNull(),
    requestPayload: text("request_payload"),
    responsePayload: text("response_payload"),
    ...createdAtOnly,
  },
  (t) => [
    index("index_ddm_synchronization_request_histories_endpoint").on(
      t.deviceIdentifier,
      t.endpoint,
    ),
    index("index_ddm_synchronization_request_histories_created_at").on(t.createdAt),
  ],
);

export const managedAppleAccounts = pgTable(
  "managed_apple_accounts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("index_managed_apple_accounts_email").on(t.email)],
);

export const managedAppleAccountAccessTokens = pgTable(
  "managed_apple_account_access_tokens",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    managedAppleAccountId: bigint("managed_apple_account_id", { mode: "number" }).notNull(),
    token: varchar("token", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (t) => [
    uniqueIndex("index_managed_apple_account_access_tokens_token").on(t.token),
    index("index_managed_apple_account_access_tokens_expires_at").on(t.expiresAt),
  ],
);

export const byodDevices = pgTable(
  "byod_devices",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    enrollmentId: varchar("enrollment_id", { length: 255 }).notNull(),
    ...createdAtOnly,
  },
  (t) => [uniqueIndex("index_byod_devices_enrollment_id").on(t.enrollmentId)],
);

export const managedAppleAccountAccessTokenUsages = pgTable(
  "managed_apple_account_access_token_usages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    managedAppleAccountAccessTokenId: bigint("managed_apple_account_access_token_id", {
      mode: "number",
    }).notNull(),
    deviceIdentifier: varchar("device_identifier", { length: 255 }).notNull(),
  },
  (t) => [
    uniqueIndex("idx_managed_apple_account_access_token_usages_device_identifier").on(
      t.deviceIdentifier,
    ),
    uniqueIndex("index_managed_apple_account_access_token_usages_token_id").on(
      t.managedAppleAccountAccessTokenId,
    ),
  ],
);

export const byodPushEndpoints = pgTable(
  "byod_push_endpoints",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    byodDeviceId: bigint("byod_device_id", { mode: "number" }).notNull(),
    token: varchar("token", { length: 255 }).notNull(),
    pushMagic: varchar("push_magic", { length: 255 }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("index_byod_push_tokens_byod_device_id").on(t.byodDeviceId)],
);
