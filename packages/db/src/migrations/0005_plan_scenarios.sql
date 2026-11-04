CREATE TABLE `plan_scenario` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`plan` text NOT NULL,
	`view` text,
	`created_by` text,
	`updated_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_scenario_household_name_uidx` ON `plan_scenario` (`household_id`,`name`);--> statement-breakpoint
CREATE INDEX `plan_scenario_household_updated_idx` ON `plan_scenario` (`household_id`,`updated_at`);