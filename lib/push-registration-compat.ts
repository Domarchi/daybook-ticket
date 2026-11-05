import type {Database,DatabaseResult,PreparedStatement} from '../db/database';

export interface PushRegistrationRecord {
 id:string;ownerId:string;memberId:string;endpoint:string;p256dh:string;auth:string;now:string;
}
const SAVEPOINT='daybook_push_registration';
/** Only this PostgreSQL planner failure confirms that the legacy unique index
 * disappeared. No retry is inferred from a transport error or a generic SQLSTATE. */
function missingLegacyConflictTarget(error:unknown){
 if(!error||typeof error!=='object')return false;
 const failure=error as {code?:unknown;routine?:unknown;message?:unknown};
 return failure.code==='42P10'&&failure.routine==='infer_arbiter_indexes'&&failure.message==='there is no unique or exclusion constraint matching the ON CONFLICT specification';
}
function statements(database:Database,input:PushRegistrationRecord,composite:boolean):PreparedStatement[]{
 return [
  // Same lock and bound count in both schemas: at most ten active devices per account.
  database.prepare('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))').bind(`push:${input.memberId}`),
  database.prepare(`INSERT INTO "pushSubscriptions" (id, "ownerId", "memberId", endpoint, p256dh, auth, active, "createdAt", "updatedAt")
    SELECT $1, $2, $3, $4, $5, $6, true, $7, $7
    WHERE (SELECT COUNT(*) FROM "pushSubscriptions" WHERE "ownerId" = $2 AND "memberId" = $3 AND active = true AND endpoint <> $4) < 10
    ON CONFLICT(${composite?'"ownerId","memberId",endpoint':'endpoint'}) DO UPDATE SET
      "ownerId" = EXCLUDED."ownerId", "memberId" = EXCLUDED."memberId", p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
      active = true, "updatedAt" = EXCLUDED."updatedAt",
      "createdAt" = CASE WHEN "pushSubscriptions".active = true AND "pushSubscriptions"."memberId" = EXCLUDED."memberId"
        AND "pushSubscriptions"."ownerId" = EXCLUDED."ownerId" AND "pushSubscriptions".p256dh = EXCLUDED.p256dh AND "pushSubscriptions".auth = EXCLUDED.auth
        THEN "pushSubscriptions"."createdAt" ELSE EXCLUDED."createdAt" END
    WHERE ("pushSubscriptions"."ownerId" = EXCLUDED."ownerId" AND "pushSubscriptions"."memberId" = EXCLUDED."memberId")
      OR ("pushSubscriptions".p256dh = EXCLUDED.p256dh AND "pushSubscriptions".auth = EXCLUDED.auth)
    RETURNING id`).bind(input.id,input.ownerId,input.memberId,input.endpoint,input.p256dh,input.auth,input.now),
  database.prepare(`UPDATE "pushDeliveries" d SET status = 'cancelled', "leaseUntil" = NULL, "updatedAt" = $1
    FROM "pushSubscriptions" s, "mailOutbox" o
    WHERE d."subscriptionId" = s.id AND d."eventId" = o.id AND s.endpoint = $2
    AND s."memberId" = $3 AND s."ownerId" = $4 AND d.status IN ('queued', 'processing')
    AND (o."recipientMemberId" <> s."memberId" OR o."createdAt" < s."createdAt")`).bind(input.now,input.endpoint,input.memberId,input.ownerId),
 ];
}
/** Transitional E6 only. E7 registers directly against its composite target.
 * The fallback stays in one transaction, after a confirmed savepoint rollback
 * and before any COMMIT attempt. Its second failure is never retried. */
export async function registerPushSubscriptionBatch(database:Database,input:PushRegistrationRecord):Promise<DatabaseResult[]>{
 const legacy=statements(database,input,false),composite=statements(database,input,true);
 return database.transaction(async client=>{
  await client.query(`SAVEPOINT ${SAVEPOINT}`);
  const locked=await database.execute<Record<string,unknown>>(legacy[0],client);
  let inserted:DatabaseResult;
  try{inserted=await database.execute<Record<string,unknown>>(legacy[1],client);}
  catch(error){
   if(!missingLegacyConflictTarget(error))throw error;
   // If rollback acknowledgement is lost/fails, leave immediately. The outer
   // transaction cleans up; it must never repeat an uncertain write/commit.
   await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
   const results:DatabaseResult[]=[];
   for(const statement of composite)results.push(await database.execute<Record<string,unknown>>(statement,client));
   await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
   return results;
  }
  const cancelled=await database.execute<Record<string,unknown>>(legacy[2],client);
  await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
  return [locked,inserted,cancelled];
 });
}
