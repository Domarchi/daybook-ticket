CREATE TABLE "pushDeliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"eventId" text NOT NULL,
	"subscriptionId" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"leaseUntil" text,
	"lastErrorCode" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pushSubscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"memberId" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	"lastTestAt" text
);
--> statement-breakpoint
ALTER TABLE "pushDeliveries" ADD CONSTRAINT "pushDeliveries_eventId_mailOutbox_id_fk" FOREIGN KEY ("eventId") REFERENCES "public"."mailOutbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pushDeliveries" ADD CONSTRAINT "pushDeliveries_subscriptionId_pushSubscriptions_id_fk" FOREIGN KEY ("subscriptionId") REFERENCES "public"."pushSubscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pushSubscriptions" ADD CONSTRAINT "pushSubscriptions_memberId_members_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_delivery_event_device" ON "pushDeliveries" USING btree ("eventId","subscriptionId");--> statement-breakpoint
CREATE INDEX "push_delivery_pending" ON "pushDeliveries" USING btree ("ownerId","status","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscription_endpoint" ON "pushSubscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscription_member" ON "pushSubscriptions" USING btree ("ownerId","memberId","active");