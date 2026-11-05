CREATE TABLE "workOrganizationCatalog" (
  id text PRIMARY KEY, "ownerId" text NOT NULL REFERENCES organizations("ownerId"),
  kind text NOT NULL CHECK(kind IN ('tag','requestType','field','form')), name text NOT NULL,
  "definitionJson" text NOT NULL, version integer NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false, "createdAt" text NOT NULL, "updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX work_organization_catalog_owner_kind ON "workOrganizationCatalog" ("ownerId",kind,archived,name,id);
--> statement-breakpoint
CREATE UNIQUE INDEX work_organization_catalog_active_name ON "workOrganizationCatalog" ("ownerId",kind,lower(name)) WHERE NOT archived;
--> statement-breakpoint
CREATE TABLE "workOrganizationRevisions" (
  "catalogId" text NOT NULL REFERENCES "workOrganizationCatalog"(id), version integer NOT NULL,
  "ownerId" text NOT NULL, "definitionJson" text NOT NULL, "createdAt" text NOT NULL,
  PRIMARY KEY("catalogId",version)
);
--> statement-breakpoint
CREATE TABLE "ticketOrganization" (
  "ticketId" integer PRIMARY KEY REFERENCES tickets(id), "ownerId" text NOT NULL,
  "metadataJson" text NOT NULL, "tagIdsJson" text NOT NULL DEFAULT '[]', "waitReason" text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 0, "updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX ticket_organization_owner ON "ticketOrganization" ("ownerId","ticketId");
--> statement-breakpoint
CREATE TABLE "ticketTasks" (
  id text PRIMARY KEY, "ownerId" text NOT NULL, "ticketId" integer NOT NULL REFERENCES tickets(id),
  "createdByMemberId" text NOT NULL REFERENCES members(id), "operationId" text NOT NULL, "requestHash" text NOT NULL,
  title text NOT NULL, "assigneeMemberId" text REFERENCES members(id), "dueAt" text,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','cancelled')),
  version integer NOT NULL DEFAULT 0, "createdAt" text NOT NULL, "updatedAt" text NOT NULL,
  UNIQUE("ownerId","operationId")
);
--> statement-breakpoint
CREATE INDEX ticket_tasks_owner_ticket ON "ticketTasks" ("ownerId","ticketId","createdAt" DESC,id DESC);
--> statement-breakpoint
CREATE INDEX ticket_tasks_assignee ON "ticketTasks" ("ownerId","assigneeMemberId",status,"dueAt");
--> statement-breakpoint
CREATE TABLE "savedTicketViews" (
  id text PRIMARY KEY, "ownerId" text NOT NULL, "memberId" text NOT NULL REFERENCES members(id),
  name text NOT NULL, "filtersJson" text NOT NULL, version integer NOT NULL DEFAULT 0,
  "createdAt" text NOT NULL, "updatedAt" text NOT NULL,
  UNIQUE("memberId",name)
);
--> statement-breakpoint
CREATE INDEX saved_ticket_views_member ON "savedTicketViews" ("ownerId","memberId",name,id);
