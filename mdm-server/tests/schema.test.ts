import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/schema";

/** Every table with its exact DB column names, mirroring `Schemafile`. */
const expectedColumns: Record<string, string[]> = {
  pending_checkins: ["id", "udid", "serial_number", "imei", "created_at", "updated_at"],
  mdm_devices: ["id", "udid", "serial_number", "imei", "created_at", "updated_at"],
  mdm_push_endpoints: [
    "id",
    "mdm_device_id",
    "token",
    "push_magic",
    "unlock_token",
    "created_at",
    "updated_at",
  ],
  mdm_command_requests: ["id", "device_identifier", "request_payload", "created_at"],
  mdm_command_handling_requests: [
    "id",
    "device_identifier",
    "command_uuid",
    "request_payload",
    "created_at",
  ],
  mdm_command_histories: [
    "id",
    "device_identifier",
    "request_type",
    "command_uuid",
    "request_payload",
    "response_payload",
    "created_at",
  ],
  rts_wifi_profiles: ["id", "name", "asset_file_data", "created_at", "updated_at"],
  vpp_content_tokens: ["id", "filename", "value", "exp_date", "created_at", "updated_at"],
  ipa_files: ["id", "filename", "bundle_identifier", "asset_file_data", "created_at", "updated_at"],
  dep_server_tokens: [
    "id",
    "filename",
    "raw_payload",
    "consumer_key",
    "consumer_secret",
    "access_token",
    "access_secret",
    "access_token_expiry",
  ],
  get_token_targets: ["id", "dep_server_token_id", "server_uuid", "created_at", "updated_at"],
  get_token_histories: ["id", "iat", "jti", "service_type", "device_identifier", "jwt"],
  ddm_device_groups: ["id", "name", "created_at", "updated_at"],
  ddm_device_group_items: ["id", "ddm_device_group_id", "device_identifier", "created_at"],
  ddm_activations: ["id", "name", "type", "payload", "created_at", "updated_at"],
  ddm_activation_targets: ["id", "ddm_activation_id", "target_identifier", "created_at"],
  ddm_configurations: ["id", "name", "type", "payload", "created_at", "updated_at"],
  ddm_assets: ["id", "name", "type", "created_at"],
  ddm_asset_details: ["id", "ddm_asset_id", "target_identifier", "payload", "created_at", "updated_at"],
  ddm_managements: ["id", "name", "type", "created_at"],
  ddm_management_details: [
    "id",
    "ddm_management_id",
    "target_identifier",
    "payload",
    "created_at",
    "updated_at",
  ],
  ddm_public_assets: ["id", "name", "created_at", "updated_at"],
  ddm_public_asset_details: [
    "id",
    "ddm_public_asset_id",
    "target_identifier",
    "asset_file_data",
    "created_at",
  ],
  ddm_synchronization_request_histories: [
    "id",
    "device_identifier",
    "endpoint",
    "request_payload",
    "response_payload",
    "created_at",
  ],
  managed_apple_accounts: ["id", "email", "created_at", "updated_at"],
  managed_apple_account_access_tokens: [
    "id",
    "managed_apple_account_id",
    "token",
    "created_at",
    "expires_at",
    "updated_at",
  ],
  byod_devices: ["id", "enrollment_id", "created_at"],
  managed_apple_account_access_token_usages: [
    "id",
    "managed_apple_account_access_token_id",
    "device_identifier",
  ],
  byod_push_endpoints: ["id", "byod_device_id", "token", "push_magic", "created_at", "updated_at"],
};

describe("drizzle schema", () => {
  const tables = Object.values(schema);

  test("covers every table exactly once", () => {
    const names = tables.map((table) => getTableConfig(table).name).sort();
    expect(names).toEqual(Object.keys(expectedColumns).sort());
  });

  for (const [tableName, columns] of Object.entries(expectedColumns)) {
    test(`${tableName} has the Schemafile columns`, () => {
      const table = tables.find((t) => getTableConfig(t).name === tableName);
      expect(table).toBeDefined();
      const actual = getTableConfig(table!).columns.map((c) => c.name).sort();
      expect(actual).toEqual([...columns].sort());
    });
  }
});
