import { sql } from "drizzle-orm";
import { createDb, type Database } from "../../src/db";

/**
 * DB-backed tests run against a dedicated database (migrated with
 * `DATABASE_URL=<test-url> bun run db:migrate`), never the dev database.
 */
export function testDb(): Database {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set (e.g. postgres://pguser:pgpassword@localhost:5433/mdm_bun_test)",
    );
  }
  return createDb(url);
}

const TABLES = [
  "pending_checkins",
  "mdm_devices",
  "mdm_push_endpoints",
  "mdm_command_requests",
  "mdm_command_handling_requests",
  "mdm_command_histories",
  "rts_wifi_profiles",
  "vpp_content_tokens",
  "ipa_files",
  "dep_server_tokens",
  "get_token_targets",
  "get_token_histories",
  "ddm_device_groups",
  "ddm_device_group_items",
  "ddm_activations",
  "ddm_activation_targets",
  "ddm_configurations",
  "ddm_assets",
  "ddm_asset_details",
  "ddm_managements",
  "ddm_management_details",
  "ddm_public_assets",
  "ddm_public_asset_details",
  "ddm_synchronization_request_histories",
  "managed_apple_accounts",
  "managed_apple_account_access_tokens",
  "byod_devices",
  "managed_apple_account_access_token_usages",
  "byod_push_endpoints",
];

export async function truncateAll(db: Database): Promise<void> {
  await db.execute(
    sql.raw(`TRUNCATE ${TABLES.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`),
  );
}
