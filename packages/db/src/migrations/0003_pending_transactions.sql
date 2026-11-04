ALTER TABLE `transaction` ADD `status` text DEFAULT 'posted' NOT NULL;--> statement-breakpoint
ALTER TABLE `transaction` ADD `captured_via` text;--> statement-breakpoint
ALTER TABLE `transaction` ADD `captured_at` integer;--> statement-breakpoint
ALTER TABLE `transaction` ADD `client_ref` text;--> statement-breakpoint
CREATE INDEX `transaction_account_status_date_idx` ON `transaction` (`account_id`,`status`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_household_client_ref_uidx` ON `transaction` (`household_id`,`client_ref`) WHERE client_ref is not null;