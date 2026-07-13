CREATE TABLE `desktop_activation_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`license_id` text NOT NULL,
	`kind` text NOT NULL,
	`code_hash` text NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`expires_at` integer NOT NULL,
	`redeemed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `desktop_activation_grants_code_hash_unique` ON `desktop_activation_grants` (`code_hash`);--> statement-breakpoint
CREATE INDEX `desktop_activation_grants_license_idx` ON `desktop_activation_grants` (`license_id`);--> statement-breakpoint
CREATE INDEX `desktop_activation_grants_expires_idx` ON `desktop_activation_grants` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `desktop_license_keys` (
	`license_id` text NOT NULL,
	`pool_key_id` text NOT NULL,
	`is_emergency` integer DEFAULT false NOT NULL,
	`assigned_at` integer NOT NULL,
	PRIMARY KEY(`license_id`, `pool_key_id`),
	FOREIGN KEY (`license_id`) REFERENCES `desktop_licenses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pool_key_id`) REFERENCES `tinypng_key_pool`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `desktop_license_keys_pool_key_unique` ON `desktop_license_keys` (`pool_key_id`);--> statement-breakpoint
CREATE INDEX `desktop_license_keys_license_idx` ON `desktop_license_keys` (`license_id`);--> statement-breakpoint
CREATE TABLE `desktop_license_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`license_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`quota_total` integer DEFAULT 10000 NOT NULL,
	`used_count` integer DEFAULT 0 NOT NULL,
	`reserved_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`license_id`) REFERENCES `desktop_licenses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `desktop_license_periods_license_starts_unique` ON `desktop_license_periods` (`license_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `desktop_license_periods_license_expires_idx` ON `desktop_license_periods` (`license_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `desktop_licenses` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`device_id` text,
	`access_token_hash` text,
	`key_limit` integer DEFAULT 60 NOT NULL,
	`created_at` integer NOT NULL,
	`activated_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `desktop_licenses_access_token_hash_unique` ON `desktop_licenses` (`access_token_hash`);--> statement-breakpoint
CREATE INDEX `desktop_licenses_status_idx` ON `desktop_licenses` (`status`);--> statement-breakpoint
CREATE INDEX `desktop_licenses_device_id_idx` ON `desktop_licenses` (`device_id`);--> statement-breakpoint
CREATE TABLE `desktop_usage_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`license_id` text NOT NULL,
	`period_id` text NOT NULL,
	`requested_count` integer NOT NULL,
	`success_count` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`license_id`) REFERENCES `desktop_licenses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`period_id`) REFERENCES `desktop_license_periods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `desktop_usage_reservations_license_status_idx` ON `desktop_usage_reservations` (`license_id`,`status`);--> statement-breakpoint
CREATE INDEX `desktop_usage_reservations_expires_idx` ON `desktop_usage_reservations` (`status`,`expires_at`);