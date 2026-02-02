CREATE TABLE `tinypng_key_pool` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`api_key` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tinypng_key_pool_email_unique` ON `tinypng_key_pool` (`email`);--> statement-breakpoint
CREATE INDEX `tinypng_key_pool_status_idx` ON `tinypng_key_pool` (`status`);