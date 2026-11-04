CREATE TABLE `billing_event` (
	`provider` text NOT NULL,
	`event_id` text NOT NULL,
	`type` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`provider`, `event_id`)
);
--> statement-breakpoint
CREATE TABLE `billing_order` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text,
	`user_id` text,
	`provider` text NOT NULL,
	`interval` text NOT NULL,
	`months` integer NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`price_tier` text DEFAULT 'standard' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payment_url` text,
	`provider_ref` text,
	`period_end` integer,
	`is_test` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`paid_at` integer,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `billing_order_household_idx` ON `billing_order` (`household_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `billing_order_status_idx` ON `billing_order` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `household_entitlement` (
	`household_id` text NOT NULL,
	`provider` text NOT NULL,
	`plan` text DEFAULT 'pro' NOT NULL,
	`status` text NOT NULL,
	`interval` text,
	`period_end` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`provider_customer_id` text,
	`provider_subscription_id` text,
	`provider_modified_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`household_id`, `provider`),
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `household_entitlement_subscription_idx` ON `household_entitlement` (`provider_subscription_id`);--> statement-breakpoint
CREATE TABLE `usage_counter` (
	`household_id` text NOT NULL,
	`metric` text NOT NULL,
	`period` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`household_id`, `metric`, `period`),
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade
);
