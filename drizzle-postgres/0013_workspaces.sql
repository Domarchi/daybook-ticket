CREATE TABLE "workspaceProfiles" (
 "workspaceId" text PRIMARY KEY REFERENCES organizations(id), "ownerId" text NOT NULL UNIQUE REFERENCES organizations("ownerId"),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','active','suspended')), "brandName" text NOT NULL,
 "mailFrom" text, "mailEnabled" boolean NOT NULL DEFAULT false, "inboundEnabled" boolean NOT NULL DEFAULT false,
 "limitsJson" text NOT NULL, version integer NOT NULL DEFAULT 0, "quotaEpoch" bigint NOT NULL DEFAULT 0,
 "createdAt" text NOT NULL, "updatedAt" text NOT NULL, "lastJobAt" text,
 CHECK(jsonb_typeof("limitsJson"::jsonb)='object')
);
--> statement-breakpoint
ALTER TABLE invitations ADD COLUMN "acceptedAt" text, ADD COLUMN "acceptedUserId" text;
--> statement-breakpoint
DROP INDEX "push_subscription_endpoint";
--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscription_endpoint" ON "pushSubscriptions"("ownerId","memberId",endpoint);
--> statement-breakpoint
CREATE FUNCTION "daybook_workspace_quota"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE profile "workspaceProfiles"%ROWTYPE; used bigint; cap bigint; metric text; month text:=to_char(now() AT TIME ZONE 'UTC','YYYY-MM');
BEGIN
 IF TG_TABLE_NAME='mailOutbox' THEN
   IF NEW.event='password_reset' OR EXISTS(SELECT 1 FROM "mailOutbox" WHERE "eventKey"=NEW."eventKey") THEN RETURN NEW; END IF;
 END IF;
 SELECT * INTO profile FROM "workspaceProfiles" WHERE "ownerId"=NEW."ownerId" FOR UPDATE;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF profile.state='suspended' THEN RAISE EXCEPTION 'workspace_paused'; END IF;
 IF TG_TABLE_NAME='members' THEN
   IF NEW.status='revoked' OR (TG_OP='UPDATE' AND OLD.status<>'revoked') THEN RETURN NEW; END IF;
   metric:='members'; SELECT count(*) INTO used FROM members WHERE "ownerId"=NEW."ownerId" AND status<>'revoked';
 ELSIF TG_TABLE_NAME='tickets' THEN
   metric:='ticketsMonthly'; SELECT count(*) INTO used FROM tickets WHERE "ownerId"=NEW."ownerId" AND left("createdAt",7)=month;
 ELSIF TG_TABLE_NAME='messages' THEN
   metric:='messagesMonthly'; SELECT count(*) INTO used FROM messages WHERE "ownerId"=NEW."ownerId" AND left("createdAt",7)=month;
 ELSIF TG_TABLE_NAME='attachments' THEN
   IF NEW.status='deleted' OR (TG_OP='UPDATE' AND OLD.status<>'deleted' AND NEW.size<=OLD.size) THEN RETURN NEW; END IF;
   metric:='storageBytes'; SELECT COALESCE(sum(size),0) INTO used FROM attachments WHERE "ownerId"=NEW."ownerId" AND status<>'deleted' AND id<>NEW.id;
   used:=used+NEW.size-1;
 ELSIF TG_TABLE_NAME='mailOutbox' THEN
   IF NEW.event='password_reset' OR EXISTS(SELECT 1 FROM "mailOutbox" WHERE "eventKey"=NEW."eventKey") THEN RETURN NEW; END IF;
   metric:='mailMonthly'; SELECT count(*) INTO used FROM "mailOutbox" WHERE "ownerId"=NEW."ownerId" AND event<>'password_reset' AND left("createdAt",7)=month;
 END IF;
 cap:=(profile."limitsJson"::jsonb->>metric)::bigint;
 IF cap IS NULL OR cap<1 OR used>=cap THEN RAISE EXCEPTION 'workspace_quota_exceeded'; END IF;
 -- The write fences even REPEATABLE READ contenders; a stale snapshot must retry rather than exceed capacity.
 UPDATE "workspaceProfiles" SET "quotaEpoch"="quotaEpoch"+1 WHERE "ownerId"=NEW."ownerId";
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER "workspace_quota_members" BEFORE INSERT OR UPDATE OF status ON members FOR EACH ROW EXECUTE FUNCTION "daybook_workspace_quota"();
--> statement-breakpoint
CREATE TRIGGER "workspace_quota_tickets" BEFORE INSERT ON tickets FOR EACH ROW EXECUTE FUNCTION "daybook_workspace_quota"();
--> statement-breakpoint
CREATE TRIGGER "workspace_quota_messages" BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION "daybook_workspace_quota"();
--> statement-breakpoint
CREATE TRIGGER "workspace_quota_attachments" BEFORE INSERT OR UPDATE OF size,status ON attachments FOR EACH ROW EXECUTE FUNCTION "daybook_workspace_quota"();
--> statement-breakpoint
CREATE TRIGGER "workspace_quota_mail" BEFORE INSERT ON "mailOutbox" FOR EACH ROW EXECUTE FUNCTION "daybook_workspace_quota"();
