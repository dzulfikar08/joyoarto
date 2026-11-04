CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_provider_account_uidx` ON `account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `api_token` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`token_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_token_token_hash_unique` ON `api_token` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_token_user_idx` ON `api_token` (`user_id`);--> statement-breakpoint
CREATE TABLE `budget` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`category_id` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_household_category_uidx` ON `budget` (`household_id`,`category_id`);--> statement-breakpoint
CREATE TABLE `category` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`kind` text NOT NULL,
	`icon` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_household_slug_uidx` ON `category` (`household_id`,`slug`);--> statement-breakpoint
CREATE TABLE `fin_account` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`institution` text DEFAULT 'other' NOT NULL,
	`type` text NOT NULL,
	`currency` text DEFAULT 'IDR' NOT NULL,
	`last4` text,
	`opening_balance` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fin_account_household_idx` ON `fin_account` (`household_id`);--> statement-breakpoint
CREATE TABLE `household` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_currency` text DEFAULT 'IDR' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `household_member` (
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`household_id`, `user_id`),
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `household_member_user_idx` ON `household_member` (`user_id`);--> statement-breakpoint
CREATE TABLE `import_batch` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`account_id` text NOT NULL,
	`source` text NOT NULL,
	`file_name` text,
	`file_key` text,
	`row_count` integer DEFAULT 0 NOT NULL,
	`inserted_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`period_from` text,
	`period_to` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `fin_account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `import_batch_household_idx` ON `import_batch` (`household_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `import_mapping` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`institution` text DEFAULT 'other' NOT NULL,
	`config` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `import_mapping_household_idx` ON `import_mapping` (`household_id`);--> statement-breakpoint
CREATE TABLE `mcp_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`tool` text NOT NULL,
	`args` text,
	`outcome` text NOT NULL,
	`ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcp_audit_user_created_idx` ON `mcp_audit` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rule` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`field` text NOT NULL,
	`match` text NOT NULL,
	`pattern` text NOT NULL,
	`account_id` text,
	`direction` text,
	`min_amount` integer,
	`max_amount` integer,
	`set_category_id` text,
	`set_merchant` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `fin_account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rule_household_idx` ON `rule` (`household_id`,`priority`);--> statement-breakpoint
CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_household_name_uidx` ON `tag` (`household_id`,`name`);--> statement-breakpoint
CREATE TABLE `transaction` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`description` text NOT NULL,
	`merchant` text,
	`note` text,
	`category_id` text,
	`category_source` text,
	`rule_id` text,
	`balance_after` integer,
	`external_ref` text,
	`dedupe_key` text NOT NULL,
	`import_batch_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `fin_account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batch`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_account_dedupe_uidx` ON `transaction` (`account_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `transaction_household_date_idx` ON `transaction` (`household_id`,`date`);--> statement-breakpoint
CREATE INDEX `transaction_account_date_idx` ON `transaction` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `transaction_household_category_idx` ON `transaction` (`household_id`,`category_id`,`date`);--> statement-breakpoint
CREATE INDEX `transaction_household_merchant_idx` ON `transaction` (`household_id`,`merchant`);--> statement-breakpoint
CREATE INDEX `transaction_batch_idx` ON `transaction` (`import_batch_id`);--> statement-breakpoint
CREATE TABLE `transaction_tag` (
	`transaction_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`transaction_id`, `tag_id`),
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transaction_tag_tag_idx` ON `transaction_tag` (`tag_id`);--> statement-breakpoint
CREATE TABLE `jwks` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`alg` text,
	`crv` text
);
--> statement-breakpoint
CREATE TABLE `oauth_access_token` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text,
	`reference_id` text,
	`authorization_code_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`refresh_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`revoked` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`refresh_id`) REFERENCES `oauth_refresh_token`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_access_token_token_unique` ON `oauth_access_token` (`token`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_client_idx` ON `oauth_access_token` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_user_idx` ON `oauth_access_token` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_session_idx` ON `oauth_access_token` (`session_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_code_idx` ON `oauth_access_token` (`authorization_code_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_refresh_idx` ON `oauth_access_token` (`refresh_id`);--> statement-breakpoint
CREATE TABLE `oauth_client` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`client_secret` text,
	`client_discovery_id` text,
	`disabled` integer DEFAULT false,
	`skip_consent` integer,
	`enable_end_session` integer,
	`subject_type` text,
	`scopes` text,
	`client_credentials_scopes` text,
	`user_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
	`updated_at` integer,
	`name` text,
	`uri` text,
	`icon` text,
	`contacts` text,
	`tos` text,
	`policy` text,
	`software_id` text,
	`software_version` text,
	`software_statement` text,
	`redirect_uris` text NOT NULL,
	`post_logout_redirect_uris` text,
	`backchannel_logout_uri` text,
	`backchannel_logout_session_required` integer,
	`token_endpoint_auth_method` text,
	`application_type` text,
	`jwks` text,
	`jwks_uri` text,
	`grant_types` text,
	`response_types` text,
	`require_pkce` integer,
	`dpop_bound_access_tokens` integer DEFAULT false,
	`reference_id` text,
	`metadata` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_client_client_id_unique` ON `oauth_client` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_client_user_idx` ON `oauth_client` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_client_created_idx` ON `oauth_client` (`created_at`);--> statement-breakpoint
CREATE TABLE `oauth_client_assertion` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_client_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`metadata` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `oauth_resource`(`identifier`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_client_resource_pair_uidx` ON `oauth_client_resource` (`client_id`,`resource_id`);--> statement-breakpoint
CREATE INDEX `oauth_client_resource_resource_idx` ON `oauth_client_resource` (`resource_id`);--> statement-breakpoint
CREATE TABLE `oauth_consent` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text,
	`reference_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`scopes` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
	`updated_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_consent_client_idx` ON `oauth_consent` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_consent_user_idx` ON `oauth_consent` (`user_id`);--> statement-breakpoint
CREATE TABLE `oauth_refresh_token` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text NOT NULL,
	`reference_id` text,
	`authorization_code_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`revoked` integer,
	`rotated_at` integer,
	`rotation_replay_response` text,
	`rotation_replay_expires_at` integer,
	`auth_time` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_refresh_token_token_unique` ON `oauth_refresh_token` (`token`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_client_idx` ON `oauth_refresh_token` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_user_idx` ON `oauth_refresh_token` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_session_idx` ON `oauth_refresh_token` (`session_id`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_code_idx` ON `oauth_refresh_token` (`authorization_code_id`);--> statement-breakpoint
CREATE TABLE `oauth_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`name` text NOT NULL,
	`access_token_ttl` integer,
	`refresh_token_ttl` integer,
	`signing_algorithm` text,
	`signing_key_id` text,
	`allowed_scopes` text,
	`custom_claims` text,
	`dpop_bound_access_tokens_required` integer DEFAULT false,
	`disabled` integer DEFAULT false,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
	`updated_at` integer,
	`policy_version` integer DEFAULT 1,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_resource_identifier_unique` ON `oauth_resource` (`identifier`);