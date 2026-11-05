CREATE TABLE `statement_format_request` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`atur_issue_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `statement_format_request_user_idx` ON `statement_format_request` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `statement_format_request_fp_idx` ON `statement_format_request` (`fingerprint`,`household_id`);