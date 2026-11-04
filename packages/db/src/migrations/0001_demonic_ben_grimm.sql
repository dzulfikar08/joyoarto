CREATE TABLE `payment_hint` (
	`household_id` text NOT NULL,
	`source` text NOT NULL,
	`ref` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`merchant` text NOT NULL,
	`category` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`household_id`, `ref`),
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `transaction` ADD `payment_ref` text;--> statement-breakpoint
CREATE INDEX `transaction_household_payment_ref_idx` ON `transaction` (`household_id`,`payment_ref`);