CREATE TABLE `email_import_address` (
	`household_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_import_address_token_unique` ON `email_import_address` (`token`);--> statement-breakpoint
CREATE TABLE `inbound_email` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`from_address` text NOT NULL,
	`user_id` text,
	`subject` text,
	`status` text NOT NULL,
	`detail` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `inbound_email_household_created_idx` ON `inbound_email` (`household_id`,`created_at`);