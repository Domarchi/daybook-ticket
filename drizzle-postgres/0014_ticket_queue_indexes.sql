-- Additive only: two indexes for the inbox queues of workspaces with many tickets. No data, column or constraint changes.
CREATE INDEX "tickets_owner_assignee_page" ON "tickets" ("ownerId","assigneeMemberId","updatedAt" DESC,id DESC);
--> statement-breakpoint
CREATE INDEX "tickets_owner_active_page" ON "tickets" ("ownerId","updatedAt" DESC,id DESC) WHERE status<>'resolved';
