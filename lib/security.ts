import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getDatabase } from '../db';
import type { Database } from '../db/database';
import type { AccessContext } from './access';
import { ApiError } from './server';
import { hasFreshProof, publicSessionLabel, requiresMfaChallenge, safeOperationalCode, type SecurityAction, type SecurityPolicy, type SecurityProof } from './security-model';
import { operatorGranted } from './workspace-model';

export type SecurityReader = Pick<PoolClient, 'query'>;
function reader(database = getDatabase()): SecurityReader {
  return { query: async (sql: string, values?: unknown[]) => {
    const result = await database.prepare(sql).bind(...(values ?? []) as (string | number | boolean | null)[]).all();
    return { rows: result.results, rowCount: result.meta.changes };
  } } as SecurityReader;
}
export const securityRedirect = '/security';
/** Legacy platform operator boundary; the multi-workspace delivery replaces this with its explicit operator grant. */
export function assertPlatformBackupAccess(access:Pick<AccessContext,'role'|'organizationId'>&Partial<Pick<AccessContext,'userId'|'member'>>) {
  if(access.organizationId!=='daybook'||!operatorGranted({userId:access.userId||'',email:access.member?.email||''}))throw new ApiError(403,'El respaldo completo requiere una concesión explícita de operador de plataforma. Usa la exportación privada del negocio.');
}
function securityPath(access:AccessContext){return !access.organizationId?'/account/security':access.organizationId==='daybook'?securityRedirect:`/w/${access.organizationId}/security`;}
export async function consumeSecurityAttempt(access:Pick<AccessContext,'userId'>,database=getDatabase(),now=Date.now()) {
  const key=`daybook-security-reauth:${access.userId}`;
  const row=await database.prepare(`INSERT INTO "authRateLimit" (id,key,count,"lastRequest") VALUES ($1,$1,1,$2)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN "authRateLimit"."lastRequest"<$2-60000 THEN 1 ELSE "authRateLimit".count+1 END,
    "lastRequest"=CASE WHEN "authRateLimit"."lastRequest"<$2-60000 THEN $2 ELSE "authRateLimit"."lastRequest" END RETURNING count`).bind(key,now).first<{count:number}>();
  if(!row || row.count>5)throw new ApiError(429,'Espera un minuto antes de volver a verificar tu contraseña.');
}
export async function readIdentitySecurity(access: Pick<AccessContext, 'ownerId' | 'userId' | 'sessionId'>, query = reader()) {
  const result = await query.query(`SELECT u."twoFactorEnabled", p."requireStaffMfa",p."activatedAt",p.version,
    a."passwordVerifiedAt",a."mfaVerifiedAt",profile."recoveryAcknowledgedAt"
    FROM "authUser" u LEFT JOIN "securityPolicies" p ON p."ownerId"=$1
    LEFT JOIN "securityAssurances" a ON a."sessionId"=$2 AND a."userId"=u.id
    LEFT JOIN "securityProfiles" profile ON profile."userId"=u.id WHERE u.id=$3
      AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM "authSession" s WHERE s.id=$2 AND s."userId"=u.id AND s."expiresAt">NOW()))`, [access.ownerId, access.sessionId ?? null, access.userId]);
  const row = result.rows[0];
  if (!row) throw new ApiError(401, 'Inicia sesión para continuar.');
  const policy: SecurityPolicy = { requireStaffMfa: Boolean(row.requireStaffMfa), activatedAt: row.activatedAt ?? null, version: row.version ?? 0 };
  const proof: SecurityProof = { passwordVerifiedAt: row.passwordVerifiedAt ?? null, mfaVerifiedAt: row.mfaVerifiedAt ?? null };
  return { policy, proof, enabled: Boolean(row.twoFactorEnabled), recoveryAcknowledgedAt: row.recoveryAcknowledgedAt as string | null };
}
export async function assertSecurityAccess(access: AccessContext, query = reader()) {
  const state = await readIdentitySecurity(access, query);
  if (requiresMfaChallenge(access.role, state.policy, state.enabled, state.proof)) throw new ApiError(428, state.enabled ? 'Verifica tu segundo factor para continuar con el equipo.' : 'Activa el doble factor para continuar con el equipo.', securityPath(access));
}
export async function requireFreshSecurity(access: AccessContext, query = reader()) {
  const state = await readIdentitySecurity(access, query);
  if (!access.sessionId || !hasFreshProof(state.proof, state.enabled)) throw new ApiError(428, 'Verifica tu identidad para esta acción sensible.', securityPath(access));
}
export async function recordSecurityEvent(query: SecurityReader, access: Pick<AccessContext, 'ownerId' | 'userId' | 'member'>, action: SecurityAction, targetId: string | null = null) {
  if(!access.ownerId)return;
  await query.query(`INSERT INTO "securityAudit" (id,"ownerId","actorMemberId","actorUserId","actorName",action,"targetId","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [randomUUID(), access.ownerId, access.member.id, access.userId, access.member.name, action, targetId, new Date().toISOString()]);
}
/** Called only from a successful Better Auth endpoint; token stays server-side. */
export async function recordAuthProof(database: Database, token: string, userId: string, factor: 'password' | 'mfa') {
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO "securityAssurances" ("sessionId","userId","passwordVerifiedAt","mfaVerifiedAt","updatedAt")
    SELECT id,"userId",CASE WHEN $3='password' THEN $4 ELSE NULL END,CASE WHEN $3='mfa' THEN $4 ELSE NULL END,$4
    FROM "authSession" WHERE token=$1 AND "userId"=$2 AND "expiresAt">NOW()
    ON CONFLICT ("sessionId") DO UPDATE SET "passwordVerifiedAt"=CASE WHEN $3='password' THEN $4 ELSE "securityAssurances"."passwordVerifiedAt" END,
    "mfaVerifiedAt"=CASE WHEN $3='mfa' THEN $4 ELSE "securityAssurances"."mfaVerifiedAt" END,"updatedAt"=$4`).bind(token,userId,factor,now).run();
}
export async function recordCurrentPasswordProof(access: AccessContext, database = getDatabase()) {
  if (!access.sessionId) throw new ApiError(401, 'Inicia sesión para continuar.');
  await database.transaction(async tx => {
    const live = (await tx.query('SELECT id FROM "authSession" WHERE id=$1 AND "userId"=$2 AND "expiresAt">NOW() FOR UPDATE', [access.sessionId,access.userId])).rows[0];
    if (!live) throw new ApiError(401,'La sesión finalizó. Inicia sesión nuevamente.');
    const now=new Date().toISOString();
    await tx.query(`INSERT INTO "securityAssurances" ("sessionId","userId","passwordVerifiedAt","updatedAt") VALUES ($1,$2,$3,$3)
      ON CONFLICT ("sessionId") DO UPDATE SET "passwordVerifiedAt"=$3,"updatedAt"=$3`,[access.sessionId,access.userId,now]);
    await recordSecurityEvent(tx,access,'password_verified');
  });
}
export async function getSecurityStatus(access: AccessContext, database=getDatabase()) {
  const state=await readIdentitySecurity(access,reader(database));
  return { enabled:state.enabled, policy:state.policy, recoveryAcknowledged:Boolean(state.recoveryAcknowledgedAt),
    challengeRequired:requiresMfaChallenge(access.role,state.policy,state.enabled,state.proof), fresh:hasFreshProof(state.proof,state.enabled),
    memberId:access.member.id, role:access.role, canManagePolicy:access.role==='owner' };
}
export async function acknowledgeRecovery(access: AccessContext, database=getDatabase()) {
  return database.transaction(async tx=>{
    const state=await readIdentitySecurity(access,tx);
    if(!state.enabled || !state.proof.mfaVerifiedAt) throw new ApiError(409,'Verifica primero tu aplicación autenticadora.');
    const now=new Date().toISOString();
    await tx.query(`INSERT INTO "securityProfiles" ("userId","recoveryAcknowledgedAt","updatedAt") VALUES ($1,$2,$2)
      ON CONFLICT ("userId") DO UPDATE SET "recoveryAcknowledgedAt"=$2,"updatedAt"=$2`,[access.userId,now]);
    await recordSecurityEvent(tx,access,'recovery_acknowledged');
    return {acknowledged:true};
  });
}
export async function saveSecurityPolicy(access: AccessContext, input:{requireStaffMfa:boolean;version:number}, database=getDatabase()) {
  if(access.role!=='owner') throw new ApiError(403,'Solo el propietario puede cambiar la obligación de doble factor.');
  await database.transaction(async tx=>{
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`daybook-ticket-work:${access.ownerId}`]);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`security-policy:${access.ownerId}`]);
    const member=(await tx.query('SELECT role FROM members WHERE id=$1 AND "ownerId"=$2 AND "userId"=$3 AND status=\'active\' FOR UPDATE',[access.member.id,access.ownerId,access.userId])).rows[0];
    if(member?.role!=='owner')throw new ApiError(403,'Tu acceso cambió.');
    await requireFreshSecurity(access,tx);
    const state=await readIdentitySecurity(access,tx);
    if(!input.requireStaffMfa&&access.organizationId!=='daybook'&&(await tx.query('SELECT "workspaceId" FROM "workspaceProfiles" WHERE "ownerId"=$1 AND state=\'active\'',[access.ownerId])).rows[0])throw new ApiError(409,'Pausa el piloto antes de retirar la obligación de MFA del equipo.');
    if(state.policy.version!==input.version)throw new ApiError(409,'La política cambió. Actualiza antes de guardar.');
    if(input.requireStaffMfa && (!state.enabled || !state.recoveryAcknowledgedAt))throw new ApiError(409,'El propietario debe verificar su segundo factor y confirmar la custodia de los códigos de recuperación.');
    const now=new Date().toISOString(),activatedAt=input.requireStaffMfa ? state.policy.requireStaffMfa ? state.policy.activatedAt : now : null;
    await tx.query(`INSERT INTO "securityPolicies" ("ownerId","requireStaffMfa","activatedAt",version,"updatedAt") VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT ("ownerId") DO UPDATE SET "requireStaffMfa"=$2,"activatedAt"=$3,version=$4,"updatedAt"=$5`,[access.ownerId,input.requireStaffMfa,activatedAt,input.version+1,now]);
    // The activating owner's already verified session is the only session carried across the activation boundary.
    if(input.requireStaffMfa && !state.policy.requireStaffMfa) await tx.query('UPDATE "securityAssurances" SET "mfaVerifiedAt"=$1,"updatedAt"=$1 WHERE "sessionId"=$2 AND "userId"=$3',[now,access.sessionId,access.userId]);
    await recordSecurityEvent(tx,access,input.requireStaffMfa?'policy_enabled':'policy_disabled');
  });
  return getSecurityStatus(access,database);
}
export async function listOwnSessions(access:AccessContext,database=getDatabase()) {
  const rows=(await database.prepare('SELECT id,"userAgent","createdAt","expiresAt" FROM "authSession" WHERE "userId"=$1 AND "expiresAt">NOW() ORDER BY "createdAt" DESC,id LIMIT 100').bind(access.userId).all<{id:string;userAgent:string|null;createdAt:Date;expiresAt:Date}>()).results;
  return {sessions:rows.map(row=>({id:row.id,label:publicSessionLabel(row.userAgent),createdAt:new Date(row.createdAt).toISOString(),expiresAt:new Date(row.expiresAt).toISOString(),current:row.id===access.sessionId}))};
}
export async function revokeOwnSessions(access:AccessContext,input:{id?:string;others?:boolean},database=getDatabase()) {
  return database.transaction(async tx=>{
    await requireFreshSecurity(access,tx);
    if(input.id===access.sessionId)throw new ApiError(400,'Usa Cerrar sesión para salir de este dispositivo.');
    const removed=await tx.query(`DELETE FROM "authSession" WHERE "userId"=$1 AND id<>$2 AND ${input.others?'TRUE':'id=$3'} RETURNING id`,input.others?[access.userId,access.sessionId]:[access.userId,access.sessionId,input.id]);
    if(removed.rowCount)await recordSecurityEvent(tx,access,input.others?'other_sessions_revoked':'session_revoked',input.others?null:removed.rows[0].id);
    return {revoked:removed.rowCount ?? 0};
  });
}
export async function listSecurityAudit(access:AccessContext,cursor:string|null,database=getDatabase()) {
  if(!['owner','admin'].includes(access.role))throw new ApiError(403,'Solo administración puede consultar la auditoría.');
  let before:{at:string;id:string}|null=null;
  if(cursor){try{const value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));if(typeof value.at!=='string'||!Number.isFinite(Date.parse(value.at))||typeof value.id!=='string'||value.id.length>100)throw Error();before=value;}catch{throw new ApiError(400,'El cursor no es válido.');}}
  const rows=(await database.prepare(`SELECT id,"actorMemberId","actorName",action,"targetId","createdAt" FROM "securityAudit" WHERE "ownerId"=$1 ${before?'AND ("createdAt",id)<($2,$3)':''} ORDER BY "createdAt" DESC,id DESC LIMIT 51`).bind(...before?[access.ownerId,before.at,before.id]:[access.ownerId]).all<{id:string;actorMemberId:string|null;actorName:string;action:SecurityAction;targetId:string|null;createdAt:string}>()).results;
  const items=rows.slice(0,50),tail=items.at(-1);
  return {items,nextCursor:rows.length>50&&tail?Buffer.from(JSON.stringify({at:tail.createdAt,id:tail.id})).toString('base64url'):null};
}
export async function getSecurityHealth(access:AccessContext,database=getDatabase()) {
  if(!['owner','admin'].includes(access.role))throw new ApiError(403,'Solo administración puede consultar la salud del servicio.');
  const [mail,inbound,scheduler,backups,serviceContext,automation]=await Promise.all([
    database.prepare('SELECT status,count(*)::int AS count FROM "mailOutbox" WHERE "ownerId"=$1 GROUP BY status').bind(access.ownerId).all<{status:string;count:number}>(),
    database.prepare('SELECT status,count(*)::int AS count FROM "inboundMailJobs" WHERE "ownerId"=$1 GROUP BY status').bind(access.ownerId).all<{status:string;count:number}>(),
    database.prepare('SELECT "lastStartedAt","lastSucceededAt","lastFailedAt","lastErrorCode" FROM "notificationJobHealth" WHERE "ownerId"=$1').bind(access.ownerId).first<{lastStartedAt:string|null;lastSucceededAt:string|null;lastFailedAt:string|null;lastErrorCode:string|null}>(),
    database.prepare('SELECT id,status,"localDate","verifiedAt","errorCode" FROM "automaticBackupRuns" WHERE "ownerId"=$1 ORDER BY "createdAt" DESC LIMIT 5').bind(access.ownerId).all<{id:string;status:string;localDate:string;verifiedAt:string|null;errorCode:string|null}>(),
    database.prepare('SELECT "lastStartedAt","lastSucceededAt","lastFailedAt","lastErrorCode" FROM "serviceContextJobHealth" WHERE "ownerId"=$1').bind(access.ownerId).first<{lastStartedAt:string|null;lastSucceededAt:string|null;lastFailedAt:string|null;lastErrorCode:string|null}>(),
    database.prepare('SELECT "lastStartedAt","lastSucceededAt","lastFailedAt","lastErrorCode" FROM "automationJobHealth" WHERE "ownerId"=$1').bind(access.ownerId).first<{lastStartedAt:string|null;lastSucceededAt:string|null;lastFailedAt:string|null;lastErrorCode:string|null}>(),
  ]);
  const jobs=[{id:'notifications',name:'Avisos y recordatorios',state:scheduler},{id:'service-context',name:'Garantías y renovaciones',state:serviceContext},{id:'automation',name:'Reglas internas',state:automation}].map(({id,name,state})=>({id,name,lastStartedAt:state?.lastStartedAt??null,lastSucceededAt:state?.lastSucceededAt??null,lastFailedAt:state?.lastFailedAt??null,lastErrorCode:safeOperationalCode(state?.lastErrorCode)}));
  return {mail:mail.results,inbound:inbound.results,jobs,scheduler:scheduler?{...scheduler,lastErrorCode:safeOperationalCode(scheduler.lastErrorCode)}:null,
    backups:backups.results.map(row=>({...row,errorCode:safeOperationalCode(row.errorCode)})),checkedAt:new Date().toISOString()};
}
