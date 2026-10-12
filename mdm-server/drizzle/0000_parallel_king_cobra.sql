CREATE TABLE "byod_devices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"enrollment_id" varchar(255) NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "byod_push_endpoints" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"byod_device_id" bigint NOT NULL,
	"token" varchar(255) NOT NULL,
	"push_magic" varchar(255) NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddm_activation_targets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ddm_activation_id" bigint NOT NULL,
	"target_identifier" varchar(255),
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddm_activations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(255) NOT NULL,
	"payload" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddm_asset_details" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ddm_asset_id" bigint NOT NULL,
	"target_identifier" varchar(255),
	"payload" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddm_assets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(255) NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddm_configurations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(255) NOT NULL,
	"payload" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddm_device_group_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ddm_device_group_id" bigint NOT NULL,
	"device_identifier" varchar(255) NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddm_device_groups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddm_management_details" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ddm_management_id" bigint NOT NULL,
	"target_identifier" varchar(255),
	"payload" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddm_managements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(255) NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddm_public_asset_details" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ddm_public_asset_id" bigint NOT NULL,
	"target_identifier" varchar(255),
	"asset_file_data" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddm_public_assets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddm_synchronization_request_histories" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"device_identifier" varchar(255) NOT NULL,
	"endpoint" varchar(255) NOT NULL,
	"request_payload" text,
	"response_payload" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dep_server_tokens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"filename" varchar(255) NOT NULL,
	"raw_payload" text,
	"consumer_key" varchar(255) NOT NULL,
	"consumer_secret" varchar(255) NOT NULL,
	"access_token" varchar(255) NOT NULL,
	"access_secret" varchar(255) NOT NULL,
	"access_token_expiry" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "get_token_histories" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"iat" timestamp NOT NULL,
	"jti" varchar(255) NOT NULL,
	"service_type" varchar(255) NOT NULL,
	"device_identifier" varchar(255) NOT NULL,
	"jwt" text
);
--> statement-breakpoint
CREATE TABLE "get_token_targets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dep_server_token_id" bigint NOT NULL,
	"server_uuid" varchar(255) NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ipa_files" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"filename" varchar(255) NOT NULL,
	"bundle_identifier" varchar(255) NOT NULL,
	"asset_file_data" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "managed_apple_account_access_token_usages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"managed_apple_account_access_token_id" bigint NOT NULL,
	"device_identifier" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "managed_apple_account_access_tokens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"managed_apple_account_id" bigint NOT NULL,
	"token" varchar(255) NOT NULL,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "managed_apple_accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mdm_command_handling_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"device_identifier" varchar(255) NOT NULL,
	"command_uuid" varchar(255) NOT NULL,
	"request_payload" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mdm_command_histories" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"device_identifier" varchar(255) NOT NULL,
	"request_type" varchar(255) NOT NULL,
	"command_uuid" varchar(255) NOT NULL,
	"request_payload" text NOT NULL,
	"response_payload" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mdm_command_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"device_identifier" varchar(255) NOT NULL,
	"request_payload" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mdm_devices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"udid" varchar(255) NOT NULL,
	"serial_number" varchar(255) NOT NULL,
	"imei" varchar(255),
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mdm_push_endpoints" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mdm_device_id" bigint NOT NULL,
	"token" varchar(255) NOT NULL,
	"push_magic" varchar(255) NOT NULL,
	"unlock_token" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_checkins" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"udid" varchar(255) NOT NULL,
	"serial_number" varchar(255) NOT NULL,
	"imei" varchar(255),
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rts_wifi_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"asset_file_data" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vpp_content_tokens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"filename" varchar(255) NOT NULL,
	"value" varchar(255) NOT NULL,
	"exp_date" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "index_byod_devices_enrollment_id" ON "byod_devices" USING btree ("enrollment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "index_byod_push_tokens_byod_device_id" ON "byod_push_endpoints" USING btree ("byod_device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "index_ddm_activation_target_identifier" ON "ddm_activation_targets" USING btree ("target_identifier","ddm_activation_id");--> statement-breakpoint
CREATE INDEX "index_ddm_activation_target_ddm_activation_id" ON "ddm_activation_targets" USING btree ("ddm_activation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "index_ddm_activation_name" ON "ddm_activations" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "index_ddm_asset_detail_target_identifier" ON "ddm_asset_details" USING btree ("target_identifier","ddm_asset_id");--> statement-breakpoint
CREATE INDEX "index_ddm_asset_detail_ddm_asset_id" ON "ddm_asset_details" USING btree ("ddm_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "index_ddm_asset_name" ON "ddm_assets" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "index_ddm_configuration_name" ON "ddm_configurations" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "index_ddm_device_group_item_device_identifier" ON "ddm_device_group_items" USING btree ("device_identifier","ddm_device_group_id");--> statement-breakpoint
CREATE INDEX "index_ddm_device_group_item_ddm_device_group" ON "ddm_device_group_items" USING btree ("ddm_device_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "index_ddm_device_groups_name" ON "ddm_device_groups" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "index_ddm_management_detail_target_identifier" ON "ddm_management_details" USING btree ("target_identifier","ddm_management_id");--> statement-breakpoint
CREATE INDEX "index_ddm_management_detail_ddm_management_id" ON "ddm_management_details" USING btree ("ddm_management_id");--> statement-breakpoint
CREATE UNIQUE INDEX "index_management_name" ON "ddm_managements" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "index_ddm_public_asset_detail_target_identifier" ON "ddm_public_asset_details" USING btree ("target_identifier","ddm_public_asset_id");--> statement-breakpoint
CREATE INDEX "index_ddm_public_asset_detail_ddm_public_asset_id" ON "ddm_public_asset_details" USING btree ("ddm_public_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "index_ddm_public_asset_name" ON "ddm_public_assets" USING btree ("name");--> statement-breakpoint
CREATE INDEX "index_ddm_synchronization_request_histories_endpoint" ON "ddm_synchronization_request_histories" USING btree ("device_identifier","endpoint");--> statement-breakpoint
CREATE INDEX "index_ddm_synchronization_request_histories_created_at" ON "ddm_synchronization_request_histories" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "index_dep_server_tokens_filename" ON "dep_server_tokens" USING btree ("filename");--> statement-breakpoint
CREATE UNIQUE INDEX "index_get_token_histories_jti" ON "get_token_histories" USING btree ("jti");--> statement-breakpoint
CREATE INDEX "index_get_token_histories_device_service_iat" ON "get_token_histories" USING btree ("device_identifier","service_type","iat");--> statement-breakpoint
CREATE UNIQUE INDEX "index_ipa_files_filename" ON "ipa_files" USING btree ("filename");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_managed_apple_account_access_token_usages_device_identifier" ON "managed_apple_account_access_token_usages" USING btree ("device_identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "index_managed_apple_account_access_token_usages_token_id" ON "managed_apple_account_access_token_usages" USING btree ("managed_apple_account_access_token_id");--> statement-breakpoint
CREATE UNIQUE INDEX "index_managed_apple_account_access_tokens_token" ON "managed_apple_account_access_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "index_managed_apple_account_access_tokens_expires_at" ON "managed_apple_account_access_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "index_managed_apple_accounts_email" ON "managed_apple_accounts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "index_mdm_command_handling_requests_device_identifier_command" ON "mdm_command_handling_requests" USING btree ("device_identifier","command_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "index_command_histories_device_identifier_command_uuid" ON "mdm_command_histories" USING btree ("device_identifier","command_uuid");--> statement-breakpoint
CREATE INDEX "index_command_histories_created_at" ON "mdm_command_histories" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "index_mdm_command_requests_device_identifier" ON "mdm_command_requests" USING btree ("device_identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "index_mdm_devices_udid" ON "mdm_devices" USING btree ("udid");--> statement-breakpoint
CREATE UNIQUE INDEX "index_mdm_devices_serial_number" ON "mdm_devices" USING btree ("serial_number");--> statement-breakpoint
CREATE UNIQUE INDEX "index_mdm_push_tokens_mdm_device_id" ON "mdm_push_endpoints" USING btree ("mdm_device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "index_pending_checkins_udid" ON "pending_checkins" USING btree ("udid");--> statement-breakpoint
CREATE UNIQUE INDEX "index_rts_wifi_profiles_name" ON "rts_wifi_profiles" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "index_vpp_content_tokens_filename" ON "vpp_content_tokens" USING btree ("filename");