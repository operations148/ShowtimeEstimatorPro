CREATE TABLE `analytics_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`estimator_id` text NOT NULL,
	`event_type` text NOT NULL,
	`step_id` text,
	`session_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `estimator_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`estimator_id` text NOT NULL,
	`version` integer NOT NULL,
	`questions` text NOT NULL,
	`pricing_config_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`estimator_id`) REFERENCES `estimators`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `estimators` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`public_key` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`current_version_id` text,
	`branding` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `otp_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`code_hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`locked_until` integer,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pricing_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`estimator_id` text,
	`config` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`estimator_id`) REFERENCES `estimators`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `service_areas` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`zip` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`estimator_id` text NOT NULL,
	`version_id` text NOT NULL,
	`lead_email` text NOT NULL,
	`lead_zip` text NOT NULL,
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
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`external_id` text NOT NULL,
	`status` text DEFAULT 'trialing' NOT NULL,
	`plan_id` text NOT NULL,
	`current_period_end` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`notification_recipients` text,
	`service_area_behavior` text DEFAULT 'block' NOT NULL,
	`retention_days` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`name` text,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `analytics_tenant_event_idx` ON `analytics_events` (`tenant_id`,`event_type`);--> statement-breakpoint
CREATE INDEX `analytics_created_at_idx` ON `analytics_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_tenant_idx` ON `audit_logs` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_timestamp_idx` ON `audit_logs` (`timestamp`);--> statement-breakpoint
CREATE UNIQUE INDEX `estimators_public_key_unique` ON `estimators` (`public_key`);--> statement-breakpoint
CREATE INDEX `estimators_tenant_idx` ON `estimators` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `estimators_public_key_idx` ON `estimators` (`public_key`);--> statement-breakpoint
CREATE INDEX `otp_identifier_idx` ON `otp_codes` (`identifier`);--> statement-breakpoint
CREATE INDEX `pricing_configs_tenant_idx` ON `pricing_configs` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `service_areas_tenant_zip_idx` ON `service_areas` (`tenant_id`,`zip`);--> statement-breakpoint
CREATE INDEX `submissions_tenant_idx` ON `submissions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `submissions_estimator_idx` ON `submissions` (`estimator_id`);--> statement-breakpoint
CREATE INDEX `submissions_created_at_idx` ON `submissions` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_tenant_id_unique` ON `subscriptions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_tenant_idx` ON `subscriptions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_external_idx` ON `subscriptions` (`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_unique` ON `tenants` (`slug`);--> statement-breakpoint
CREATE INDEX `users_tenant_idx` ON `users` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `users_email_idx` ON `users` (`email`);