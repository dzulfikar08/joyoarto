CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`household_id` text,
	`kind` text NOT NULL,
	`engine` text NOT NULL,
	`model` text NOT NULL,
	`outcome` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_usage_user_kind_idx` ON `ai_usage` (`user_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `joyo_conversation` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `joyo_conversation_user_idx` ON `joyo_conversation` (`user_id`,`household_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `joyo_message` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`steps` text,
	`proposals` text,
	`model` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `joyo_conversation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `joyo_message_conversation_idx` ON `joyo_message` (`conversation_id`,`created_at`);