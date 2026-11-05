CREATE TABLE "automaticBackupRuns" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"environment" text NOT NULL,
	"localDate" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"keyId" text,
	"archiveSha256" text,
	"sizeBytes" integer,
	"reservedBytes" integer DEFAULT 33554432 NOT NULL,
	"rowCount" integer,
	"fileCount" integer,
	"errorCode" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	"uploadedAt" text,
	"verifiedAt" text,
	"deletedAt" text,
	CONSTRAINT "automatic_backup_environment" CHECK ("automaticBackupRuns"."environment" IN ('qa','production')),
	CONSTRAINT "automatic_backup_status" CHECK ("automaticBackupRuns"."status" IN ('processing','complete','failed','deleting','deleted')),
	CONSTRAINT "automatic_backup_attempts" CHECK ("automaticBackupRuns"."attempts" BETWEEN 0 AND 3),
	CONSTRAINT "automatic_backup_reserved" CHECK ("automaticBackupRuns"."reservedBytes" BETWEEN 0 AND 33554432),
	CONSTRAINT "automatic_backup_size" CHECK ("automaticBackupRuns"."sizeBytes" IS NULL OR "automaticBackupRuns"."sizeBytes" BETWEEN 1 AND 33554432)
);
--> statement-breakpoint
CREATE TABLE "automaticBackupSettings" (
	"ownerId" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"localTime" text DEFAULT '03:00' NOT NULL,
	"retention" integer DEFAULT 7 NOT NULL,
	"storageBudgetMiB" integer DEFAULT 512 NOT NULL,
	"planReviewedAt" text,
	"version" integer DEFAULT 0 NOT NULL,
	"leaseToken" text,
	"leaseUntil" text,
	"lastErrorCode" text,
	"updatedAt" text NOT NULL,
	CONSTRAINT "automatic_backup_time" CHECK ("automaticBackupSettings"."localTime" ~ '^([01][0-9]|2[0-3]):(00|30)$'),
	CONSTRAINT "automatic_backup_retention" CHECK ("automaticBackupSettings"."retention" BETWEEN 1 AND 14),
	CONSTRAINT "automatic_backup_budget" CHECK ("automaticBackupSettings"."storageBudgetMiB" BETWEEN 64 AND 1024),
	CONSTRAINT "automatic_backup_version" CHECK ("automaticBackupSettings"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "automaticBackupUsage" (
	"ownerId" text NOT NULL,
	"environment" text NOT NULL,
	"month" text NOT NULL,
	"transferBytes" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "automaticBackupUsage_ownerId_environment_month_pk" PRIMARY KEY("ownerId","environment","month"),
	CONSTRAINT "automatic_backup_usage_environment" CHECK ("automaticBackupUsage"."environment" IN ('qa','production')),
	CONSTRAINT "automatic_backup_usage_bytes" CHECK ("automaticBackupUsage"."transferBytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inboundMailJobFiles" (
	"providerId" text NOT NULL,
	"providerAttachmentId" text NOT NULL,
	"attachmentId" text NOT NULL,
	"sha256" text NOT NULL,
	"createdAt" text NOT NULL,
	CONSTRAINT "inboundMailJobFiles_providerId_providerAttachmentId_pk" PRIMARY KEY("providerId","providerAttachmentId")
);
--> statement-breakpoint
CREATE TABLE "inboundMailJobs" (
	"providerId" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"memberId" text NOT NULL,
	"environment" text NOT NULL,
	"envelopeJson" text NOT NULL,
	"envelopeHash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" text,
	"lastAttemptAt" text,
	"lastErrorCode" text,
	"leaseToken" text,
	"leaseUntil" text,
	"ticketId" integer,
	"messageId" integer,
	"manualRetries" integer DEFAULT 0 NOT NULL,
	"lastRetryKey" text,
	"lastRetriedAt" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	CONSTRAINT "inbound_jobs_environment" CHECK ("inboundMailJobs"."environment" IN ('qa','production')),
	CONSTRAINT "inbound_jobs_status" CHECK ("inboundMailJobs"."status" IN ('pending','processing','retry','processed','rejected','failed')),
	CONSTRAINT "inbound_jobs_attempts" CHECK ("inboundMailJobs"."attempts" BETWEEN 0 AND 6),
	CONSTRAINT "inbound_jobs_manual_retries" CHECK ("inboundMailJobs"."manualRetries" BETWEEN 0 AND 3)
);
--> statement-breakpoint
CREATE TABLE "ticketPresence" (
	"ownerId" text NOT NULL,
	"ticketId" integer NOT NULL,
	"memberId" text NOT NULL,
	"tabId" text NOT NULL,
	"activity" text NOT NULL,
	"updatedAt" text NOT NULL,
	"expiresAt" text NOT NULL,
	CONSTRAINT "ticketPresence_ownerId_ticketId_memberId_tabId_pk" PRIMARY KEY("ownerId","ticketId","memberId","tabId"),
	CONSTRAINT "ticket_presence_activity" CHECK ("ticketPresence"."activity" IN ('viewing','reply','note')),
	CONSTRAINT "ticket_presence_tab" CHECK ("ticketPresence"."tabId" ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "isTest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "isTest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "automaticBackupRuns" ADD CONSTRAINT "automaticBackupRuns_ownerId_organizations_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."organizations"("ownerId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automaticBackupSettings" ADD CONSTRAINT "automaticBackupSettings_ownerId_organizations_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."organizations"("ownerId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automaticBackupUsage" ADD CONSTRAINT "automaticBackupUsage_ownerId_organizations_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."organizations"("ownerId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inboundMailJobFiles" ADD CONSTRAINT "inboundMailJobFiles_providerId_inboundMailJobs_providerId_fk" FOREIGN KEY ("providerId") REFERENCES "public"."inboundMailJobs"("providerId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inboundMailJobFiles" ADD CONSTRAINT "inboundMailJobFiles_attachmentId_attachments_id_fk" FOREIGN KEY ("attachmentId") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inboundMailJobs" ADD CONSTRAINT "inboundMailJobs_ownerId_organizations_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."organizations"("ownerId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inboundMailJobs" ADD CONSTRAINT "inboundMailJobs_memberId_members_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inboundMailJobs" ADD CONSTRAINT "inboundMailJobs_ticketId_tickets_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inboundMailJobs" ADD CONSTRAINT "inboundMailJobs_messageId_messages_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketPresence" ADD CONSTRAINT "ticketPresence_ownerId_organizations_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."organizations"("ownerId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketPresence" ADD CONSTRAINT "ticketPresence_ticketId_tickets_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketPresence" ADD CONSTRAINT "ticketPresence_memberId_members_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automatic_backup_daily" ON "automaticBackupRuns" USING btree ("ownerId","environment","localDate");--> statement-breakpoint
CREATE INDEX "automatic_backup_owner_status" ON "automaticBackupRuns" USING btree ("ownerId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_job_file_attachment" ON "inboundMailJobFiles" USING btree ("attachmentId");--> statement-breakpoint
CREATE INDEX "inbound_jobs_owner_recent" ON "inboundMailJobs" USING btree ("ownerId","createdAt" DESC NULLS LAST,"providerId");--> statement-breakpoint
CREATE INDEX "inbound_jobs_due" ON "inboundMailJobs" USING btree ("ownerId","status","nextAttemptAt","leaseUntil");--> statement-breakpoint
CREATE INDEX "ticket_presence_ticket_expiry" ON "ticketPresence" USING btree ("ownerId","ticketId","expiresAt");--> statement-breakpoint
CREATE INDEX "ticket_presence_member_expiry" ON "ticketPresence" USING btree ("ownerId","memberId","expiresAt");