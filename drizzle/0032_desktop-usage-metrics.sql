ALTER TABLE `desktop_licenses` ADD `buyer_id` text;--> statement-breakpoint
ALTER TABLE `desktop_usage_reservations` ADD `original_bytes` integer;--> statement-breakpoint
ALTER TABLE `desktop_usage_reservations` ADD `compressed_bytes` integer;--> statement-breakpoint
ALTER TABLE `desktop_usage_reservations` ADD `app_version` text;