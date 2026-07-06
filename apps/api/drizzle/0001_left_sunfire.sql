ALTER TABLE `tenants` ADD `branding` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `integrations` text;--> statement-breakpoint
/*
 Drop NOT NULL from submissions.lead_zip (zip is now optional). SQLite cannot
 alter a column constraint in place, so rebuild the table: create → copy → drop
 → rename → re-index. No table has an inbound FK to `submissions`, so this is safe.
*/
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`estimator_id` text NOT NULL,
	`version_id` text NOT NULL,
	`lead_email` text NOT NULL,
	`lead_zip` text,
	`lead_name` text,
	`lead_phone` text,
	`answers` text NOT NULL,
	`estimate_min` integer NOT NULL,
	`estimate_max` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`service_area_valid` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`estimator_id`) REFERENCES `estimators`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_submissions`(`id`, `tenant_id`, `estimator_id`, `version_id`, `lead_email`, `lead_zip`, `lead_name`, `lead_phone`, `answers`, `estimate_min`, `estimate_max`, `currency`, `service_area_valid`, `created_at`) SELECT `id`, `tenant_id`, `estimator_id`, `version_id`, `lead_email`, `lead_zip`, `lead_name`, `lead_phone`, `answers`, `estimate_min`, `estimate_max`, `currency`, `service_area_valid`, `created_at` FROM `submissions`;--> statement-breakpoint
DROP TABLE `submissions`;--> statement-breakpoint
ALTER TABLE `__new_submissions` RENAME TO `submissions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `submissions_tenant_idx` ON `submissions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `submissions_estimator_idx` ON `submissions` (`estimator_id`);--> statement-breakpoint
CREATE INDEX `submissions_created_at_idx` ON `submissions` (`created_at`);
