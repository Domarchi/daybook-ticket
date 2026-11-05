ALTER TABLE "authUser" ADD COLUMN "twoFactorEnabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE "twoFactor" (
  id text PRIMARY KEY NOT NULL, "userId" text NOT NULL REFERENCES "authUser"(id) ON DELETE CASCADE,
  secret text NOT NULL, "backupCodes" text NOT NULL, verified boolean NOT NULL DEFAULT true,
  "failedVerificationCount" integer NOT NULL DEFAULT 0, "lockedUntil" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "two_factor_user" ON "twoFactor" ("userId");
--> statement-breakpoint
CREATE TABLE "securityProfiles" (
  "userId" text PRIMARY KEY NOT NULL REFERENCES "authUser"(id) ON DELETE CASCADE,
  "recoveryAcknowledgedAt" text, "updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "securityAssurances" (
  "sessionId" text PRIMARY KEY NOT NULL REFERENCES "authSession"(id) ON DELETE CASCADE,
  "userId" text NOT NULL REFERENCES "authUser"(id) ON DELETE CASCADE,
  "passwordVerifiedAt" text, "mfaVerifiedAt" text, "updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "security_assurance_user" ON "securityAssurances" ("userId");
--> statement-breakpoint
CREATE TABLE "securityPolicies" (
  "ownerId" text PRIMARY KEY NOT NULL REFERENCES organizations("ownerId"),
  "requireStaffMfa" boolean NOT NULL DEFAULT false, "activatedAt" text,
  version integer NOT NULL DEFAULT 0 CHECK(version>=0), "updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "securityAudit" (
  id text PRIMARY KEY NOT NULL, "ownerId" text NOT NULL REFERENCES organizations("ownerId"),
  "actorMemberId" text, "actorUserId" text NOT NULL, "actorName" text NOT NULL, action text NOT NULL,
  "targetId" text, "createdAt" text NOT NULL,
  CONSTRAINT "security_audit_action" CHECK(action IN ('password_verified','mfa_verified','mfa_enabled','mfa_disabled','recovery_acknowledged','recovery_regenerated','policy_enabled','policy_disabled','session_revoked','other_sessions_revoked','platform_backup_created','business_export_created','member_permissions_changed','configuration_changed'))
);
--> statement-breakpoint
CREATE INDEX "security_audit_page" ON "securityAudit" ("ownerId","createdAt" DESC,id DESC);
--> statement-breakpoint
CREATE FUNCTION "daybook_security_audit_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'security_audit_is_append_only'; END; $$;
--> statement-breakpoint
CREATE TRIGGER "security_audit_immutable" BEFORE UPDATE OR DELETE ON "securityAudit" FOR EACH ROW EXECUTE FUNCTION "daybook_security_audit_immutable"();
