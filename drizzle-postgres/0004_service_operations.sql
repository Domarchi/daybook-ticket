CREATE TABLE "agentAvailability" (
	"memberId" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"capacity" integer DEFAULT 20 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"lastAssignedAt" text,
	"updatedAt" text NOT NULL,
	CONSTRAINT "agent_availability_capacity" CHECK ("agentAvailability"."capacity" BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "assignmentRules" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"customerCompanyId" text,
	"department" text,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"agentMemberIdsJson" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	CONSTRAINT "assignment_rules_position" CHECK ("assignmentRules"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "servicePolicies" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"scopeKey" text NOT NULL,
	"customerCompanyId" text,
	"calendarJson" text NOT NULL,
	"slaHoursJson" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	CONSTRAINT "service_policies_scope_check" CHECK (("servicePolicies"."scopeKey" = 'default' AND "servicePolicies"."customerCompanyId" IS NULL) OR ("servicePolicies"."customerCompanyId" IS NOT NULL AND "servicePolicies"."scopeKey" = "servicePolicies"."customerCompanyId"))
);
--> statement-breakpoint
CREATE TABLE "ticketSlaOutcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"ticketId" integer NOT NULL,
	"actorMemberId" text,
	"startedAt" text,
	"dueAt" text NOT NULL,
	"resolvedAt" text NOT NULL,
	"customerCompanyId" text,
	"policySnapshot" text
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "slaPolicySnapshot" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "slaStartedAt" text;--> statement-breakpoint
ALTER TABLE "agentAvailability" ADD CONSTRAINT "agentAvailability_memberId_members_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentAvailability" ADD CONSTRAINT "agentAvailability_ownerId_organizations_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."organizations"("ownerId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignmentRules" ADD CONSTRAINT "assignmentRules_ownerId_organizations_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."organizations"("ownerId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignmentRules" ADD CONSTRAINT "assignmentRules_customerCompanyId_customerCompanies_id_fk" FOREIGN KEY ("customerCompanyId") REFERENCES "public"."customerCompanies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servicePolicies" ADD CONSTRAINT "servicePolicies_ownerId_organizations_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."organizations"("ownerId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servicePolicies" ADD CONSTRAINT "servicePolicies_customerCompanyId_customerCompanies_id_fk" FOREIGN KEY ("customerCompanyId") REFERENCES "public"."customerCompanies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketSlaOutcomes" ADD CONSTRAINT "ticketSlaOutcomes_ownerId_organizations_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."organizations"("ownerId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketSlaOutcomes" ADD CONSTRAINT "ticketSlaOutcomes_ticketId_tickets_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketSlaOutcomes" ADD CONSTRAINT "ticketSlaOutcomes_actorMemberId_members_id_fk" FOREIGN KEY ("actorMemberId") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketSlaOutcomes" ADD CONSTRAINT "ticketSlaOutcomes_customerCompanyId_customerCompanies_id_fk" FOREIGN KEY ("customerCompanyId") REFERENCES "public"."customerCompanies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_availability_owner" ON "agentAvailability" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "assignment_rules_owner_position" ON "assignmentRules" USING btree ("ownerId","position");--> statement-breakpoint
CREATE UNIQUE INDEX "service_policies_scope" ON "servicePolicies" USING btree ("ownerId","scopeKey");--> statement-breakpoint
CREATE INDEX "ticket_sla_outcomes_period" ON "ticketSlaOutcomes" USING btree ("ownerId","resolvedAt");--> statement-breakpoint
CREATE INDEX "ticket_sla_outcomes_ticket" ON "ticketSlaOutcomes" USING btree ("ownerId","ticketId");