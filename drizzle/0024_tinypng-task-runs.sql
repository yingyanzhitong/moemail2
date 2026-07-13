CREATE TABLE `tinypng_task_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`message` text NOT NULL,
	`created_count` integer DEFAULT 0 NOT NULL,
	`cleaned_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tinypng_task_runs_completed_at_idx` ON `tinypng_task_runs` (`completed_at`);