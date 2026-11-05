CREATE TABLE "automationSettings" (
 "ownerId" text PRIMARY KEY REFERENCES organizations("ownerId"), enabled boolean NOT NULL DEFAULT false,
 "activatedAt" text, version integer NOT NULL DEFAULT 0, "updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taskTemplates" (
 id text PRIMARY KEY, "ownerId" text NOT NULL REFERENCES organizations("ownerId"), name text NOT NULL,
 "itemsJson" text NOT NULL, version integer NOT NULL DEFAULT 0, archived boolean NOT NULL DEFAULT false,
 "updatedByMemberId" text NOT NULL REFERENCES members(id), "createdAt" text NOT NULL, "updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX task_templates_owner ON "taskTemplates" ("ownerId",archived,name,id);
--> statement-breakpoint
CREATE UNIQUE INDEX task_templates_active_name ON "taskTemplates" ("ownerId",lower(name)) WHERE NOT archived;
--> statement-breakpoint
CREATE TABLE "automationRules" (
 id text PRIMARY KEY, "ownerId" text NOT NULL REFERENCES organizations("ownerId"), name text NOT NULL,
 "conditionsJson" text NOT NULL, "actionsJson" text NOT NULL, "referencesHash" text NOT NULL, enabled boolean NOT NULL DEFAULT false,
 position integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 0, archived boolean NOT NULL DEFAULT false,
 "enabledAt" text, "updatedByMemberId" text NOT NULL REFERENCES members(id), "createdAt" text NOT NULL, "updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX automation_rules_owner ON "automationRules" ("ownerId",enabled,archived,position,id);
--> statement-breakpoint
CREATE UNIQUE INDEX automation_rules_active_name ON "automationRules" ("ownerId",lower(name)) WHERE NOT archived;
--> statement-breakpoint
CREATE TABLE "automationRuleVersions" (
 id text PRIMARY KEY, "ownerId" text NOT NULL REFERENCES organizations("ownerId"), "ruleId" text NOT NULL REFERENCES "automationRules"(id),
 version integer NOT NULL, "snapshotJson" text NOT NULL, "changedByMemberId" text NOT NULL REFERENCES members(id), "createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX automation_rule_versions_unique ON "automationRuleVersions" ("ruleId",version);
--> statement-breakpoint
CREATE INDEX automation_rule_versions_owner ON "automationRuleVersions" ("ownerId","ruleId",version DESC);
--> statement-breakpoint
CREATE TABLE "automationEvents" (
 id text PRIMARY KEY, "ownerId" text NOT NULL REFERENCES organizations("ownerId"), "ticketId" integer NOT NULL REFERENCES tickets(id),
 "operationKey" text NOT NULL, "eventKind" text NOT NULL, "actorMemberId" text REFERENCES members(id), "requestHash" text NOT NULL, "activationVersion" integer NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','done','cancelled','failed')),
 attempts integer NOT NULL DEFAULT 0, "nextAttemptAt" text NOT NULL, "lastErrorCode" text,
 "createdAt" text NOT NULL, "updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX automation_events_operation ON "automationEvents" ("ownerId","operationKey","eventKind");
--> statement-breakpoint
CREATE INDEX automation_events_pending ON "automationEvents" ("ownerId",status,"nextAttemptAt","createdAt",id);
--> statement-breakpoint
CREATE TABLE "automationExecutions" (
 id text PRIMARY KEY, "ownerId" text NOT NULL, "eventId" text NOT NULL REFERENCES "automationEvents"(id),
 "ticketId" integer NOT NULL REFERENCES tickets(id), "ruleId" text REFERENCES "automationRules"(id), "ruleKey" text NOT NULL,
 "ruleVersion" integer NOT NULL, "ruleName" text NOT NULL, status text NOT NULL CHECK(status IN ('applied','skipped','failed')),
 "summaryJson" text NOT NULL, attempts integer NOT NULL DEFAULT 1, "createdAt" text NOT NULL, "updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX automation_executions_event_rule ON "automationExecutions" ("eventId","ruleKey","ruleVersion");
--> statement-breakpoint
CREATE INDEX automation_executions_owner ON "automationExecutions" ("ownerId","createdAt" DESC,id DESC);
--> statement-breakpoint
CREATE TABLE "automationJobHealth" (
 "ownerId" text PRIMARY KEY REFERENCES organizations("ownerId"), "lastStartedAt" text, "lastSucceededAt" text,
 "lastFailedAt" text, "lastErrorCode" text, "processedEvents" integer NOT NULL DEFAULT 0, "updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticketRelations" (
 id text PRIMARY KEY, "ownerId" text NOT NULL, "sourceTicketId" integer NOT NULL REFERENCES tickets(id),
 "targetTicketId" integer NOT NULL REFERENCES tickets(id), kind text NOT NULL CHECK(kind IN ('related','duplicate')),
 "createdByMemberId" text NOT NULL REFERENCES members(id), "operationId" text NOT NULL, "requestHash" text NOT NULL,
 version integer NOT NULL DEFAULT 0, archived boolean NOT NULL DEFAULT false, "createdAt" text NOT NULL, "updatedAt" text NOT NULL,
 CHECK("sourceTicketId"<>"targetTicketId")
);
--> statement-breakpoint
CREATE UNIQUE INDEX ticket_relations_operation ON "ticketRelations" ("ownerId","operationId");
--> statement-breakpoint
CREATE UNIQUE INDEX ticket_relations_active_pair ON "ticketRelations" ("ownerId","sourceTicketId","targetTicketId",kind) WHERE NOT archived;
--> statement-breakpoint
CREATE UNIQUE INDEX ticket_relations_one_principal ON "ticketRelations" ("ownerId","sourceTicketId") WHERE NOT archived AND kind='duplicate';
--> statement-breakpoint
CREATE INDEX ticket_relations_owner_target ON "ticketRelations" ("ownerId","targetTicketId",archived,id);
