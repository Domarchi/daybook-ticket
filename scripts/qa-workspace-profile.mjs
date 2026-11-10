/** Fictitious fixture support only. Call after inserting the named organizations
 * and keep the caller's existing QA host checks, transaction and cleanup. Never
 * changes existing profiles or discovers additional organizations to activate. */
export async function seedQaWorkspaceProfiles(query, ownerIds, at = new Date()) {
  if (!Array.isArray(ownerIds) || !ownerIds.length || ownerIds.some(id => typeof id !== 'string' || !id))
    throw Error('Explicit fixture owners required');
  const present = (await query.query(`SELECT to_regclass('public."workspaceProfiles"') AS relation`)).rows[0]?.relation;
  if (!present) return;
  const now = at instanceof Date ? at.toISOString() : at,
    limits = {
      members: 200,
      ticketsMonthly: 10000,
      messagesMonthly: 100000,
      storageBytes: 10737418240,
      mailMonthly: 100000,
    };
  await query.query(
    `INSERT INTO "workspaceProfiles"("workspaceId","ownerId",state,"brandName","limitsJson","createdAt","updatedAt") SELECT id,"ownerId",'active','Fictitious QA',$2,$3,$3 FROM organizations WHERE "ownerId"=ANY($1::text[]) AND id<>'daybook' ON CONFLICT("workspaceId") DO NOTHING`,
    [ownerIds, JSON.stringify(limits), now],
  );
}
