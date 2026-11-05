ALTER TABLE "messages" ADD COLUMN "replyToMessageId" integer REFERENCES "messages"("id") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "mailOutbox" ADD COLUMN "sourceMessageId" integer REFERENCES "messages"("id");
--> statement-breakpoint
CREATE TABLE "messageMentions" (
  "ownerId" text NOT NULL,
  "messageId" integer NOT NULL REFERENCES "messages"("id"),
  "memberId" text NOT NULL REFERENCES "members"("id"),
  "createdAt" text NOT NULL,
  PRIMARY KEY ("messageId", "memberId")
);
--> statement-breakpoint
CREATE INDEX "message_mentions_recipient" ON "messageMentions" ("ownerId", "memberId", "messageId");
--> statement-breakpoint
CREATE TABLE "ticketFollowers" (
  "ownerId" text NOT NULL,
  "ticketId" integer NOT NULL REFERENCES "tickets"("id"),
  "memberId" text NOT NULL REFERENCES "members"("id"),
  "createdAt" text NOT NULL,
  PRIMARY KEY ("ticketId", "memberId")
);
--> statement-breakpoint
CREATE INDEX "ticket_followers_owner" ON "ticketFollowers" ("ownerId", "memberId");
--> statement-breakpoint
CREATE TABLE "evolutionFeatures" (
  "ownerId" text PRIMARY KEY REFERENCES "organizations"("ownerId"),
  "featuresJson" text NOT NULL DEFAULT '{}',
  "version" integer NOT NULL DEFAULT 0,
  "updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "userPreferences" (
  "userId" text PRIMARY KEY REFERENCES "authUser"("id"),
  "theme" text NOT NULL DEFAULT 'system' CONSTRAINT "user_preferences_theme" CHECK ("theme" IN ('system', 'light', 'dark')),
  "updatedAt" text NOT NULL
);
