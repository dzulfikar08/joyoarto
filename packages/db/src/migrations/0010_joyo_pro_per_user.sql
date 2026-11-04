CREATE TABLE `joyo_pro_status` (
	`user_id` text PRIMARY KEY NOT NULL,
	`pro` integer NOT NULL,
	`until` integer,
	`plan` text,
	`source` text,
	`checked_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_pro_until` integer,
	`last_pro_lifetime` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `usage_counter` (
	`user_id` text NOT NULL,
	`metric` text NOT NULL,
	`period` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `metric`, `period`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
