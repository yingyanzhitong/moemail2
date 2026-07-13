ALTER TABLE `tinypng_key_pool` ADD `task_run_id` text;--> statement-breakpoint
CREATE INDEX `tinypng_key_pool_task_run_idx` ON `tinypng_key_pool` (`task_run_id`);