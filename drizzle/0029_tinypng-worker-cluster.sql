CREATE TABLE `tinypng_worker_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`configured_region` text,
	`actual_placement` text,
	`enabled` integer DEFAULT true NOT NULL,
	`maintenance_owner` integer DEFAULT false NOT NULL,
	`last_status` text DEFAULT 'idle' NOT NULL,
	`last_run_id` text,
	`last_run_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tinypng_worker_nodes_role_idx` ON `tinypng_worker_nodes` (`role`);--> statement-breakpoint
CREATE INDEX `tinypng_worker_nodes_status_idx` ON `tinypng_worker_nodes` (`last_status`);--> statement-breakpoint
ALTER TABLE `tinypng_task_runs` ADD `worker_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `tinypng_task_runs` ADD `cycle_id` text;--> statement-breakpoint
ALTER TABLE `tinypng_task_runs` ADD `trigger_type` text DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE `tinypng_task_runs` ADD `schedule_slot` integer;--> statement-breakpoint
ALTER TABLE `tinypng_task_runs` ADD `placement` text;--> statement-breakpoint
CREATE INDEX `tinypng_task_runs_worker_completed_at_idx` ON `tinypng_task_runs` (`worker_id`,`completed_at`);--> statement-breakpoint
CREATE INDEX `tinypng_task_runs_cycle_idx` ON `tinypng_task_runs` (`cycle_id`);--> statement-breakpoint
INSERT INTO `tinypng_worker_nodes` (`id`, `name`, `role`, `configured_region`, `enabled`, `maintenance_owner`, `last_status`, `created_at`, `updated_at`) VALUES
	('coordinator', '协调节点', 'coordinator', NULL, true, true, 'idle', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
	('registrar-apac', '亚太注册节点', 'registrar', 'aws:ap-southeast-1', true, false, 'idle', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
	('registrar-americas', '美洲注册节点', 'registrar', 'aws:us-east-1', true, false, 'idle', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
	('registrar-europe', '欧洲注册节点', 'registrar', 'aws:eu-central-1', true, false, 'idle', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
