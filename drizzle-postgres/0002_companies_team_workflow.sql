CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"memberId" text NOT NULL,
	"draftId" text NOT NULL,
	"ticketId" integer,
	"messageId" integer,
	"kind" text NOT NULL,
	"pathname" text NOT NULL,
	"name" text NOT NULL,
	"contentType" text NOT NULL,
	"size" integer NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"expiresAt" text NOT NULL,
	"uploadedAt" text,
	"validatedAt" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	CONSTRAINT "attachments_size" CHECK ("attachments"."size" BETWEEN 1 AND 10485760),
	CONSTRAINT "attachments_kind" CHECK ("attachments"."kind" IN ('request', 'reply', 'note')),
	CONSTRAINT "attachments_status" CHECK ("attachments"."status" IN ('reserved', 'uploaded', 'ready', 'attached', 'deleting', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "customerCompanies" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"ownerId" text NOT NULL,
	"name" text NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"operationId" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"memberId" text NOT NULL,
	"kind" text NOT NULL,
	"requestHash" text NOT NULL,
	"resultJson" text NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "savedReplies" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"body" text NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticketEvents" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"ticketId" integer NOT NULL,
	"actorMemberId" text,
	"actorName" text NOT NULL,
	"action" text NOT NULL,
	"beforeValue" text,
	"afterValue" text,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "customerCompanyId" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "companyAccess" text DEFAULT 'own' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "authorMemberId" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "authorRole" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "customerCompanyId" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_memberId_members_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_ticketId_tickets_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_messageId_messages_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customerCompanies" ADD CONSTRAINT "customerCompanies_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_memberId_members_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketEvents" ADD CONSTRAINT "ticketEvents_ticketId_tickets_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketEvents" ADD CONSTRAINT "ticketEvents_actorMemberId_members_id_fk" FOREIGN KEY ("actorMemberId") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_pathname" ON "attachments" USING btree ("pathname");--> statement-breakpoint
CREATE INDEX "attachments_pending" ON "attachments" USING btree ("ownerId","memberId","status","expiresAt");--> statement-breakpoint
CREATE INDEX "attachments_message" ON "attachments" USING btree ("ownerId","messageId");--> statement-breakpoint
CREATE INDEX "customer_companies_owner" ON "customerCompanies" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "operations_scope" ON "operations" USING btree ("ownerId","memberId","kind");--> statement-breakpoint
CREATE INDEX "saved_replies_owner" ON "savedReplies" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "ticket_events_owner_ticket" ON "ticketEvents" USING btree ("ownerId","ticketId","createdAt");--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_customerCompanyId_customerCompanies_id_fk" FOREIGN KEY ("customerCompanyId") REFERENCES "public"."customerCompanies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_authorMemberId_members_id_fk" FOREIGN KEY ("authorMemberId") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customerCompanyId_customerCompanies_id_fk" FOREIGN KEY ("customerCompanyId") REFERENCES "public"."customerCompanies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "members_company" ON "members" USING btree ("ownerId","customerCompanyId");--> statement-breakpoint
CREATE INDEX "tickets_company" ON "tickets" USING btree ("ownerId","customerCompanyId");--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_company_access" CHECK ("members"."companyAccess" IN ('own', 'manager') AND ("members"."companyAccess" <> 'manager' OR ("members"."role" = 'client' AND "members"."customerCompanyId" IS NOT NULL)) AND ("members"."role" = 'client' OR "members"."customerCompanyId" IS NULL));