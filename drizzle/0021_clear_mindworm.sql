CREATE TABLE `api_usage_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_endpoint_unique` ON `api_usage_stats` (`user_id`,`endpoint`);--> statement-breakpoint
CREATE INDEX `api_usage_stats_user_id_idx` ON `api_usage_stats` (`user_id`);