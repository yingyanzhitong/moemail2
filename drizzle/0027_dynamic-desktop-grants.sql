ALTER TABLE `desktop_licenses` ADD `initial_key_count` integer DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE `desktop_activation_grants` ADD `token_count` integer DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE `desktop_activation_grants` ADD `quota_total` integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE `desktop_activation_grants` ADD `duration_days` integer DEFAULT 30 NOT NULL;
