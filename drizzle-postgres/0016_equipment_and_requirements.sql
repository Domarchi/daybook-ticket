-- Additive only (F6). customerAssets gains the inventory ID ("ID del equipo"): nullable, stored normalized by the code, unique per workspace (NULLs do not collide, so existing rows need no value). ticketFulfillment is new and empty: the follow-up of a requirement. Stages, delay reasons and their texts live in lib/fulfillment-model.ts, so only the date format is a constraint.
ALTER TABLE "customerAssets" ADD COLUMN "assetTag" text;
--> statement-breakpoint
CREATE UNIQUE INDEX customer_assets_owner_tag ON "customerAssets" ("ownerId", "assetTag");
--> statement-breakpoint
CREATE TABLE "ticketFulfillment" (
 "ticketId" integer PRIMARY KEY REFERENCES tickets(id), "ownerId" text NOT NULL, stage text NOT NULL, "expectedOn" text,
 "delayReason" text, "delayNote" text, "delayedAt" text, "deliveredAt" text, "deliveredBy" text REFERENCES members(id), "receivedAt" text,
 "assetId" text REFERENCES "customerAssets"(id), "cancelReason" text, "cancelledFrom" text, version integer NOT NULL DEFAULT 0,
 "createdAt" text NOT NULL, "updatedAt" text NOT NULL,
 CONSTRAINT ticket_fulfillment_expected_on CHECK ("expectedOn" IS NULL OR "expectedOn" ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
CREATE INDEX ticket_fulfillment_owner_stage ON "ticketFulfillment" ("ownerId", stage, "expectedOn");
