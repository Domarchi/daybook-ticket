CREATE TABLE "escalationOccurrences" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"ticketId" integer NOT NULL,
	"activationAt" text NOT NULL,
	"cycleMessageId" integer NOT NULL,
	"unansweredMessageId" integer,
	"reason" text NOT NULL,
	"recipientMemberId" text NOT NULL,
	"assigneeMemberId" text,
	"stageKey" text NOT NULL,
	"dueAtSnapshot" text NOT NULL,
	"createdAt" text NOT NULL,
	"expiresAt" text NOT NULL,
	CONSTRAINT "escalation_reason" CHECK ("escalationOccurrences"."reason" IN ('unanswered','overdue'))
);
--> statement-breakpoint
CREATE TABLE "escalationSettings" (
	"ownerId" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"unansweredMinutes" integer DEFAULT 240 NOT NULL,
	"overdueMinutes" integer DEFAULT 60 NOT NULL,
	"recipientMemberIdsJson" text DEFAULT '[]' NOT NULL,
	"activatedAt" text,
	"version" integer DEFAULT 0 NOT NULL,
	"updatedAt" text NOT NULL,
	CONSTRAINT "escalation_unanswered_minutes" CHECK ("escalationSettings"."unansweredMinutes" BETWEEN 120 AND 43200),
	CONSTRAINT "escalation_overdue_minutes" CHECK ("escalationSettings"."overdueMinutes" BETWEEN 0 AND 43200)
);
--> statement-breakpoint
CREATE TABLE "inboundMailReceipts" (
	"providerId" text PRIMARY KEY NOT NULL,
	"environment" text NOT NULL,
	"payloadHash" text NOT NULL,
	"ownerId" text,
	"memberId" text,
	"ticketId" integer,
	"messageId" integer,
	"status" text NOT NULL,
	"reasonCode" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	CONSTRAINT "inbound_environment" CHECK ("inboundMailReceipts"."environment" IN ('qa','production')),
	CONSTRAINT "inbound_receipt_status" CHECK ("inboundMailReceipts"."status" IN ('processed','ignored'))
);
--> statement-breakpoint
CREATE TABLE "ticketSatisfaction" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"ticketId" integer NOT NULL,
	"resolutionKey" text NOT NULL,
	"resolvedAt" text NOT NULL,
	"requesterMemberId" text NOT NULL,
	"resolverMemberId" text,
	"customerCompanyId" text,
	"score" integer,
	"comment" text,
	"submittedAt" text,
	"createdAt" text NOT NULL,
	CONSTRAINT "satisfaction_score" CHECK ("ticketSatisfaction"."score" BETWEEN 1 AND 5),
	CONSTRAINT "satisfaction_comment" CHECK (length("ticketSatisfaction"."comment") <= 2000),
	CONSTRAINT "satisfaction_submission" CHECK (("ticketSatisfaction"."score" IS NULL) = ("ticketSatisfaction"."submittedAt" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "mailOutbox" ADD COLUMN "escalationId" text;--> statement-breakpoint
ALTER TABLE "mailOutbox" ADD COLUMN "satisfactionId" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "bodyFormat" text DEFAULT 'plain' NOT NULL;--> statement-breakpoint
ALTER TABLE "escalationOccurrences" ADD CONSTRAINT "escalationOccurrences_ownerId_organizations_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."organizations"("ownerId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalationOccurrences" ADD CONSTRAINT "escalationOccurrences_ticketId_tickets_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalationOccurrences" ADD CONSTRAINT "escalationOccurrences_cycleMessageId_messages_id_fk" FOREIGN KEY ("cycleMessageId") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalationOccurrences" ADD CONSTRAINT "escalationOccurrences_unansweredMessageId_messages_id_fk" FOREIGN KEY ("unansweredMessageId") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalationOccurrences" ADD CONSTRAINT "escalationOccurrences_recipientMemberId_members_id_fk" FOREIGN KEY ("recipientMemberId") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalationOccurrences" ADD CONSTRAINT "escalationOccurrences_assigneeMemberId_members_id_fk" FOREIGN KEY ("assigneeMemberId") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalationSettings" ADD CONSTRAINT "escalationSettings_ownerId_organizations_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."organizations"("ownerId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inboundMailReceipts" ADD CONSTRAINT "inboundMailReceipts_ownerId_organizations_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."organizations"("ownerId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inboundMailReceipts" ADD CONSTRAINT "inboundMailReceipts_memberId_members_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inboundMailReceipts" ADD CONSTRAINT "inboundMailReceipts_ticketId_tickets_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inboundMailReceipts" ADD CONSTRAINT "inboundMailReceipts_messageId_messages_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketSatisfaction" ADD CONSTRAINT "ticketSatisfaction_ownerId_organizations_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."organizations"("ownerId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketSatisfaction" ADD CONSTRAINT "ticketSatisfaction_ticketId_tickets_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketSatisfaction" ADD CONSTRAINT "ticketSatisfaction_resolutionKey_ticketSlaOutcomes_id_fk" FOREIGN KEY ("resolutionKey") REFERENCES "public"."ticketSlaOutcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketSatisfaction" ADD CONSTRAINT "ticketSatisfaction_requesterMemberId_members_id_fk" FOREIGN KEY ("requesterMemberId") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketSatisfaction" ADD CONSTRAINT "ticketSatisfaction_resolverMemberId_members_id_fk" FOREIGN KEY ("resolverMemberId") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketSatisfaction" ADD CONSTRAINT "ticketSatisfaction_customerCompanyId_customerCompanies_id_fk" FOREIGN KEY ("customerCompanyId") REFERENCES "public"."customerCompanies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "escalation_occurrence_stage" ON "escalationOccurrences" USING btree ("ownerId","ticketId","stageKey");--> statement-breakpoint
CREATE INDEX "escalation_occurrence_ticket" ON "escalationOccurrences" USING btree ("ownerId","ticketId");--> statement-breakpoint
CREATE INDEX "inbound_receipt_owner" ON "inboundMailReceipts" USING btree ("ownerId","createdAt");--> statement-breakpoint
CREATE INDEX "inbound_receipt_member" ON "inboundMailReceipts" USING btree ("ownerId","memberId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_satisfaction_resolution" ON "ticketSatisfaction" USING btree ("ownerId","resolutionKey");--> statement-breakpoint
CREATE INDEX "ticket_satisfaction_period" ON "ticketSatisfaction" USING btree ("ownerId","resolvedAt");--> statement-breakpoint
CREATE INDEX "ticket_satisfaction_ticket" ON "ticketSatisfaction" USING btree ("ownerId","ticketId");--> statement-breakpoint
ALTER TABLE "mailOutbox" ADD CONSTRAINT "mailOutbox_escalationId_escalationOccurrences_id_fk" FOREIGN KEY ("escalationId") REFERENCES "public"."escalationOccurrences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailOutbox" ADD CONSTRAINT "mailOutbox_satisfactionId_ticketSatisfaction_id_fk" FOREIGN KEY ("satisfactionId") REFERENCES "public"."ticketSatisfaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_owner_page" ON "messages" USING btree ("ownerId","ticketId","createdAt" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tickets_owner_page" ON "tickets" USING btree ("ownerId","updatedAt" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_body_format" CHECK ("messages"."bodyFormat" IN ('plain', 'markdown'));