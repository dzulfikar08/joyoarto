CREATE TABLE `waitlist_signup` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`banks` text DEFAULT '[]' NOT NULL,
	`source` text,
	`utm` text,
	`locale` text,
	`ip_hash` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_signup_email_unique` ON `waitlist_signup` (`email`);