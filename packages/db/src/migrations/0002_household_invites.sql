CREATE TABLE `household_invite` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` text,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_invite_token_hash_unique` ON `household_invite` (`token_hash`);--> statement-breakpoint
CREATE INDEX `household_invite_household_idx` ON `household_invite` (`household_id`);--> statement-breakpoint
CREATE INDEX `household_invite_email_idx` ON `household_invite` (`email`);--> statement-breakpoint
ALTER TABLE `household_member` ADD `is_default` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `household_member_default_uidx` ON `household_member` (`user_id`) WHERE is_default = 1;--> statement-breakpoint
-- Existing users keep acting in the household they used so far: their oldest membership.
UPDATE `household_member` SET `is_default` = 1 WHERE `household_id` = (
	SELECT m.`household_id` FROM `household_member` m WHERE m.`user_id` = `household_member`.`user_id`
	ORDER BY m.`created_at`, m.`household_id` LIMIT 1
);
