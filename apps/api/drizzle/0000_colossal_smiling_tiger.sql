CREATE TABLE IF NOT EXISTS "analytics_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"estimator_id" text NOT NULL,
	"event_type" text NOT NULL,
	"step_id" text,
	"session_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "estimator_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"estimator_id" text NOT NULL,
	"version" integer NOT NULL,
	"questions" jsonb NOT NULL,
	"pricing_config_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "estimators" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"public_key" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version_id" text,
	"branding" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "estimators_public_key_unique" UNIQUE("public_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "otp_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricing_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"estimator_id" text,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_areas" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"zip" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"estimator_id" text NOT NULL,
	"version_id" text NOT NULL,
	"lead_email" text NOT NULL,
	"lead_zip" text,
	"lead_name" text,
	"lead_phone" text,
	"answers" jsonb NOT NULL,
	"estimate_min" integer NOT NULL,
	"estimate_max" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"service_area_valid" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"external_id" text NOT NULL,
	"status" text DEFAULT 'trialing' NOT NULL,
	"plan_id" text NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "subscriptions_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"notification_recipients" jsonb,
	"branding" jsonb,
	"integrations" jsonb,
	"service_area_behavior" text DEFAULT 'block' NOT NULL,
	"retention_days" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"name" text,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "estimator_versions" ADD CONSTRAINT "estimator_versions_estimator_id_estimators_id_fk" FOREIGN KEY ("estimator_id") REFERENCES "public"."estimators"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "estimators" ADD CONSTRAINT "estimators_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricing_configs" ADD CONSTRAINT "pricing_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricing_configs" ADD CONSTRAINT "pricing_configs_estimator_id_estimators_id_fk" FOREIGN KEY ("estimator_id") REFERENCES "public"."estimators"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submissions" ADD CONSTRAINT "submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submissions" ADD CONSTRAINT "submissions_estimator_id_estimators_id_fk" FOREIGN KEY ("estimator_id") REFERENCES "public"."estimators"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_tenant_event_idx" ON "analytics_events" USING btree ("tenant_id","event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_created_at_idx" ON "analytics_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_tenant_idx" ON "audit_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_timestamp_idx" ON "audit_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "estimators_tenant_idx" ON "estimators" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "estimators_public_key_idx" ON "estimators" USING btree ("public_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "otp_identifier_idx" ON "otp_codes" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricing_configs_tenant_idx" ON "pricing_configs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_areas_tenant_zip_idx" ON "service_areas" USING btree ("tenant_id","zip");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submissions_tenant_idx" ON "submissions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submissions_estimator_idx" ON "submissions" USING btree ("estimator_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submissions_created_at_idx" ON "submissions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_tenant_idx" ON "subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_external_idx" ON "subscriptions" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_tenant_idx" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" USING btree ("email");