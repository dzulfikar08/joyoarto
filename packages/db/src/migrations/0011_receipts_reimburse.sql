CREATE TABLE `attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`transaction_id` text,
	`r2_key` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `attachment_transaction_idx` ON `attachment` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `attachment_household_idx` ON `attachment` (`household_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `reimbursement_claim` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`number` text NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`period_from` text NOT NULL,
	`period_to` text NOT NULL,
	`total` integer NOT NULL,
	`currency` text NOT NULL,
	`item_count` integer NOT NULL,
	`notes` text,
	`snapshot` text NOT NULL,
	`paid_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `reimbursement_profile`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reimbursement_claim_number_uidx` ON `reimbursement_claim` (`household_id`,`number`);--> statement-breakpoint
CREATE INDEX `reimbursement_claim_profile_idx` ON `reimbursement_claim` (`profile_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `reimbursement_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`company_name` text NOT NULL,
	`claimant_name` text NOT NULL,
	`employee_id` text,
	`department` text,
	`approver_name` text,
	`approver_email` text,
	`currency` text DEFAULT 'IDR' NOT NULL,
	`account_id` text,
	`last_used_at` integer,
	`archived_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `fin_account`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `reimbursement_profile_household_idx` ON `reimbursement_profile` (`household_id`);--> statement-breakpoint
ALTER TABLE `transaction` ADD `reimburse_status` text;--> statement-breakpoint
ALTER TABLE `transaction` ADD `reimburse_profile_id` text;--> statement-breakpoint
ALTER TABLE `transaction` ADD `reimburse_claim_id` text;--> statement-breakpoint
CREATE INDEX `transaction_household_reimburse_idx` ON `transaction` (`household_id`,`reimburse_status`,`date`) WHERE reimburse_status is not null;--> statement-breakpoint
CREATE INDEX `transaction_reimburse_claim_idx` ON `transaction` (`reimburse_claim_id`) WHERE reimburse_claim_id is not null;