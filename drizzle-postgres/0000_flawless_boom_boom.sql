CREATE TABLE "articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"body" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demoImports" (
	"ownerId" text PRIMARY KEY NOT NULL,
	"importedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailOutbox" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"eventKey" text NOT NULL,
	"event" text NOT NULL,
	"recipientMemberId" text NOT NULL,
	"ticketId" integer,
	"invitationId" text,
	"actionUrl" text,
	"expiresAt" text,
	"payloadJson" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"firstAttemptAt" text,
	"nextAttemptAt" text,
	"leaseUntil" text,
	"providerId" text,
	"lastErrorCode" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"ownerId" text NOT NULL,
	"userId" text,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"invitedBy" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"ticketId" integer NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"kind" text NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"name" text NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"ownerId" text PRIMARY KEY NOT NULL,
	"data" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"creationKey" text NOT NULL,
	"subject" text NOT NULL,
	"requesterName" text NOT NULL,
	"requesterEmail" text NOT NULL,
	"requesterMemberId" text,
	"department" text NOT NULL,
	"assignee" text DEFAULT '' NOT NULL,
	"assigneeMemberId" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	"dueAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authAccount" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"memberId" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"tokenHash" text NOT NULL,
	"expiresAt" text NOT NULL,
	"createdAt" text NOT NULL,
	CONSTRAINT "invitations_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "authRateLimit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"lastRequest" bigint NOT NULL,
	CONSTRAINT "authRateLimit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "authSession" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"userId" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	CONSTRAINT "authSession_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "authUser" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "authUser_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "authVerification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mailOutbox" ADD CONSTRAINT "mailOutbox_recipientMemberId_members_id_fk" FOREIGN KEY ("recipientMemberId") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailOutbox" ADD CONSTRAINT "mailOutbox_ticketId_tickets_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_ticketId_tickets_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requesterMemberId_members_id_fk" FOREIGN KEY ("requesterMemberId") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigneeMemberId_members_id_fk" FOREIGN KEY ("assigneeMemberId") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authAccount" ADD CONSTRAINT "authAccount_userId_authUser_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."authUser"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authSession" ADD CONSTRAINT "authSession_userId_authUser_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."authUser"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "articles_owner" ON "articles" USING btree ("ownerId");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_outbox_event" ON "mailOutbox" USING btree ("eventKey");--> statement-breakpoint
CREATE INDEX "mail_outbox_pending" ON "mailOutbox" USING btree ("ownerId","status","nextAttemptAt");--> statement-breakpoint
CREATE UNIQUE INDEX "members_organization_email" ON "members" USING btree ("organizationId","email");--> statement-breakpoint
CREATE UNIQUE INDEX "members_organization_user" ON "members" USING btree ("organizationId","userId");--> statement-breakpoint
CREATE INDEX "members_owner_status" ON "members" USING btree ("ownerId","status");--> statement-breakpoint
CREATE INDEX "messages_owner_ticket" ON "messages" USING btree ("ownerId","ticketId");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_owner" ON "organizations" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "tickets_owner_updated" ON "tickets" USING btree ("ownerId","updatedAt");--> statement-breakpoint
CREATE INDEX "tickets_requester" ON "tickets" USING btree ("ownerId","requesterMemberId");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_creation_key" ON "tickets" USING btree ("creationKey");--> statement-breakpoint
CREATE INDEX "auth_account_user" ON "authAccount" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_account_provider" ON "authAccount" USING btree ("providerId","accountId");--> statement-breakpoint
CREATE INDEX "auth_session_user" ON "authSession" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier" ON "authVerification" USING btree ("identifier");