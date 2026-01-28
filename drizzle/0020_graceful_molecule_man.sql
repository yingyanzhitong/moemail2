CREATE TABLE `moemail_tinypng_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`api_key` text NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `moemail_tinypng_keys_user_id_idx` ON `moemail_tinypng_keys` (`user_id`);--> statement-breakpoint
CREATE INDEX `moemail_tinypng_keys_api_key_idx` ON `moemail_tinypng_keys` (`api_key`);