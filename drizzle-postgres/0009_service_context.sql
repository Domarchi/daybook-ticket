CREATE TABLE "companyProfiles" (
 "companyId" text PRIMARY KEY REFERENCES "customerCompanies"(id), "ownerId" text NOT NULL,
 "legalName" text NOT NULL DEFAULT '', "taxId" text NOT NULL DEFAULT '', industry text NOT NULL DEFAULT '', website text NOT NULL DEFAULT '',
 "primaryContactMemberId" text REFERENCES members(id), notes text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 0,
 "createdAt" text NOT NULL, "updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companySites" (
 id text PRIMARY KEY, "ownerId" text NOT NULL, "companyId" text NOT NULL REFERENCES "customerCompanies"(id), name text NOT NULL,
 address text NOT NULL DEFAULT '', "primaryContactMemberId" text REFERENCES members(id), notes text NOT NULL DEFAULT '', archived boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 0, "createdAt" text NOT NULL, "updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX company_sites_owner_company ON "companySites" ("ownerId", "companyId", id);
--> statement-breakpoint
CREATE TABLE "customerAssets" (
 id text PRIMARY KEY, "ownerId" text NOT NULL, "companyId" text NOT NULL REFERENCES "customerCompanies"(id), name text NOT NULL,
 category text NOT NULL DEFAULT 'Equipo', vendor text NOT NULL DEFAULT '', model text NOT NULL DEFAULT '', serial text NOT NULL DEFAULT '',
 "siteId" text REFERENCES "companySites"(id), "assignedContactMemberId" text REFERENCES members(id), "responsibleMemberId" text REFERENCES members(id),
 "warrantyUntil" text, notes text NOT NULL DEFAULT '', archived boolean NOT NULL DEFAULT false, "reminderBaselineAt" text NOT NULL,
 version integer NOT NULL DEFAULT 0, "createdAt" text NOT NULL, "updatedAt" text NOT NULL,
 CONSTRAINT customer_asset_warranty_date CHECK ("warrantyUntil" IS NULL OR "warrantyUntil" ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
CREATE INDEX customer_assets_owner_company ON "customerAssets" ("ownerId", "companyId", id);
--> statement-breakpoint
CREATE TABLE "customerServices" (
 id text PRIMARY KEY, "ownerId" text NOT NULL, "companyId" text NOT NULL REFERENCES "customerCompanies"(id), name text NOT NULL,
 description text NOT NULL DEFAULT '', "responsibleMemberId" text REFERENCES members(id), notes text NOT NULL DEFAULT '', archived boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 0, "createdAt" text NOT NULL, "updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX customer_services_owner_company ON "customerServices" ("ownerId", "companyId", id);
--> statement-breakpoint
CREATE TABLE "serviceContracts" (
 id text PRIMARY KEY, "ownerId" text NOT NULL, "companyId" text NOT NULL REFERENCES "customerCompanies"(id), name text NOT NULL,
 reference text NOT NULL DEFAULT '', provider text NOT NULL DEFAULT '', "startsOn" text NOT NULL, "endsOn" text NOT NULL, "renewalOn" text,
 "responsibleMemberId" text REFERENCES members(id), "serviceIdsJson" text NOT NULL DEFAULT '[]', notes text NOT NULL DEFAULT '', archived boolean NOT NULL DEFAULT false,
 "reminderBaselineAt" text NOT NULL, version integer NOT NULL DEFAULT 0, "createdAt" text NOT NULL, "updatedAt" text NOT NULL,
 CONSTRAINT service_contract_dates CHECK ("startsOn" ~ '^\d{4}-\d{2}-\d{2}$' AND "endsOn" ~ '^\d{4}-\d{2}-\d{2}$' AND "endsOn">="startsOn" AND ("renewalOn" IS NULL OR "renewalOn">="startsOn"))
);
--> statement-breakpoint
CREATE INDEX service_contracts_owner_company ON "serviceContracts" ("ownerId", "companyId", id);
--> statement-breakpoint
CREATE TABLE "ticketServiceContext" (
 "ticketId" integer PRIMARY KEY REFERENCES tickets(id), "ownerId" text NOT NULL, version integer NOT NULL DEFAULT 0, "updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticketAssetLinks" (
 "ticketId" integer NOT NULL REFERENCES tickets(id), "assetId" text NOT NULL REFERENCES "customerAssets"(id), "ownerId" text NOT NULL,
 "createdAt" text NOT NULL, "createdBy" text NOT NULL REFERENCES members(id), PRIMARY KEY("ticketId", "assetId")
);
--> statement-breakpoint
CREATE INDEX ticket_asset_links_asset ON "ticketAssetLinks" ("ownerId", "assetId", "ticketId");
--> statement-breakpoint
CREATE TABLE "ticketContractLinks" (
 "ticketId" integer NOT NULL REFERENCES tickets(id), "contractId" text NOT NULL REFERENCES "serviceContracts"(id), "ownerId" text NOT NULL,
 "createdAt" text NOT NULL, "createdBy" text NOT NULL REFERENCES members(id), PRIMARY KEY("ticketId", "contractId")
);
--> statement-breakpoint
CREATE TABLE "serviceContextEvents" (
 id text PRIMARY KEY, "ownerId" text NOT NULL, "companyId" text NOT NULL REFERENCES "customerCompanies"(id), resource text NOT NULL, "resourceId" text NOT NULL,
 "actorMemberId" text NOT NULL REFERENCES members(id), "beforeJson" text, "afterJson" text NOT NULL, "createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX service_context_events_subject ON "serviceContextEvents" ("ownerId", resource, "resourceId", "createdAt");
--> statement-breakpoint
ALTER TABLE attachments ADD COLUMN "contractId" text REFERENCES "serviceContracts"(id);
--> statement-breakpoint
ALTER TABLE attachments DROP CONSTRAINT attachments_kind;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_kind CHECK (kind IN ('request','reply','note','contract'));
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachment_contract_scope CHECK ((kind='contract' AND "contractId" IS NOT NULL AND "ticketId" IS NULL AND "messageId" IS NULL) OR (kind<>'contract' AND "contractId" IS NULL));
--> statement-breakpoint
CREATE INDEX attachments_contract ON attachments ("ownerId", "contractId", status);
--> statement-breakpoint
CREATE TABLE "serviceContextNotificationSettings" (
 "ownerId" text PRIMARY KEY REFERENCES organizations("ownerId"), enabled boolean NOT NULL DEFAULT false,
 "activatedAt" text, version integer NOT NULL DEFAULT 0, "updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "serviceContextReminders" (
 id text PRIMARY KEY, "ownerId" text NOT NULL, "companyId" text NOT NULL REFERENCES "customerCompanies"(id), "recipientMemberId" text NOT NULL REFERENCES members(id),
 "entityKind" text NOT NULL, "entityId" text NOT NULL, "entityName" text NOT NULL, "dateValue" text NOT NULL, stage integer NOT NULL,
 "activationAt" text NOT NULL, "readAt" text, "createdAt" text NOT NULL,
 CONSTRAINT service_reminder_kind CHECK ("entityKind" IN ('asset','contract')), CONSTRAINT service_reminder_stage CHECK (stage IN (30,7,0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX service_context_reminder_stage ON "serviceContextReminders" ("ownerId", "recipientMemberId", "entityKind", "entityId", "dateValue", stage);
--> statement-breakpoint
CREATE INDEX service_context_reminders_member ON "serviceContextReminders" ("ownerId", "recipientMemberId", "createdAt", id);
--> statement-breakpoint
ALTER TABLE "mailOutbox" ADD COLUMN "serviceReminderId" text REFERENCES "serviceContextReminders"(id);
--> statement-breakpoint
CREATE TABLE "serviceContextJobHealth" (
 "ownerId" text PRIMARY KEY REFERENCES organizations("ownerId"), "cursorKey" text NOT NULL DEFAULT '',
 "leaseToken" text, "leaseUntil" text, "lastStartedAt" text, "lastSucceededAt" text, "lastFailedAt" text, "lastErrorCode" text, "lastInvocationId" text
);
