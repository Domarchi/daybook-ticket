CREATE TABLE "mailDeliveryEvents" (
	"id" text PRIMARY KEY NOT NULL,
	"outboxId" text,
	"ownerId" text,
	"providerId" text NOT NULL,
	"eventType" text NOT NULL,
	"occurredAt" text NOT NULL,
	"receivedAt" text NOT NULL,
	"payloadHash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notificationJobHealth" (
	"ownerId" text PRIMARY KEY NOT NULL,
	"lastStartedAt" text,
	"lastSucceededAt" text,
	"lastFailedAt" text,
	"lastErrorCode" text,
	"lastInvocationId" text,
	"cursorTicketId" integer DEFAULT 0 NOT NULL,
	"leaseToken" text,
	"leaseUntil" text
);
--> statement-breakpoint
CREATE TABLE "notificationSettings" (
	"ownerId" text PRIMARY KEY NOT NULL,
	"alertsActivatedAt" text NOT NULL,
	"remindersEnabled" boolean DEFAULT false NOT NULL,
	"remindersActivatedAt" text
);
--> statement-breakpoint
CREATE TABLE "reminderOccurrences" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"ticketId" integer NOT NULL,
	"cycleMessageId" integer NOT NULL,
	"unansweredMessageId" integer,
	"activationAt" text NOT NULL,
	"sequence" integer NOT NULL,
	"reasonsJson" text NOT NULL,
	"recipientMemberIdsJson" text NOT NULL,
	"dueAtSnapshot" text NOT NULL,
	"createdAt" text NOT NULL,
	"expiresAt" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mailOutbox" ADD COLUMN "readAt" text;--> statement-breakpoint
ALTER TABLE "mailOutbox" ADD COLUMN "reminderId" text;--> statement-breakpoint
ALTER TABLE "mailOutbox" ADD COLUMN "templateVersion" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "mailOutbox" ADD COLUMN "environment" text;--> statement-breakpoint
ALTER TABLE "mailOutbox" ADD COLUMN "deliveryStatus" text DEFAULT 'untracked' NOT NULL;--> statement-breakpoint
ALTER TABLE "mailOutbox" ADD COLUMN "deliveryEventAt" text;--> statement-breakpoint
ALTER TABLE "mailOutbox" ADD COLUMN "deliveredAt" text;--> statement-breakpoint
ALTER TABLE "mailOutbox" ADD COLUMN "bouncedAt" text;--> statement-breakpoint
ALTER TABLE "mailOutbox" ADD COLUMN "complainedAt" text;--> statement-breakpoint
ALTER TABLE "mailOutbox" ADD COLUMN "deliveryErrorCode" text;--> statement-breakpoint
ALTER TABLE "mailDeliveryEvents" ADD CONSTRAINT "mailDeliveryEvents_outboxId_mailOutbox_id_fk" FOREIGN KEY ("outboxId") REFERENCES "public"."mailOutbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminderOccurrences" ADD CONSTRAINT "reminderOccurrences_ticketId_tickets_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminderOccurrences" ADD CONSTRAINT "reminderOccurrences_cycleMessageId_messages_id_fk" FOREIGN KEY ("cycleMessageId") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminderOccurrences" ADD CONSTRAINT "reminderOccurrences_unansweredMessageId_messages_id_fk" FOREIGN KEY ("unansweredMessageId") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_delivery_events_outbox" ON "mailDeliveryEvents" USING btree ("ownerId","outboxId","occurredAt");--> statement-breakpoint
CREATE INDEX "mail_delivery_events_provider" ON "mailDeliveryEvents" USING btree ("providerId");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_occurrences_sequence" ON "reminderOccurrences" USING btree ("ownerId","ticketId","activationAt","cycleMessageId","sequence");--> statement-breakpoint
CREATE INDEX "reminder_occurrences_ticket" ON "reminderOccurrences" USING btree ("ownerId","ticketId","activationAt","cycleMessageId","createdAt");--> statement-breakpoint
ALTER TABLE "mailOutbox" ADD CONSTRAINT "mailOutbox_reminderId_reminderOccurrences_id_fk" FOREIGN KEY ("reminderId") REFERENCES "public"."reminderOccurrences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_outbox_alerts" ON "mailOutbox" USING btree ("ownerId","recipientMemberId","createdAt","id");--> statement-breakpoint
CREATE INDEX "mail_outbox_provider" ON "mailOutbox" USING btree ("providerId");
--> statement-breakpoint
ALTER TABLE "notificationSettings" ADD CONSTRAINT "notificationSettings_ownerId_organizations_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."organizations"("ownerId") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Establish a truthful cutoff without changing any historical read timestamp.
INSERT INTO "notificationSettings" ("ownerId", "alertsActivatedAt", "remindersEnabled", "remindersActivatedAt")
SELECT "ownerId", to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), false, NULL
FROM organizations ON CONFLICT ("ownerId") DO NOTHING;
