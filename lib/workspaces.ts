import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { db, auth, ApiError, getSettings } from './server';
import { type AccessContext } from './access';
import { hasFreshProof } from './security-model';
import { readIdentitySecurity, recordSecurityEvent } from './security';
import {
  DEFAULT_PILOT_LIMITS,
  limitsSchema,
  operatorGranted,
  verifiedWorkspaceSender,
  parsePilotCapacity,
  fitsPilotCapacity,
} from './workspace-model';
import { prepareInvitation } from './invitations';
import { notificationStatements } from './mail';
export interface CommercialWorkspace {
  workspaceId: string;
  ownerId: string;
  state: 'draft' | 'active' | 'suspended';
  brandName: string;
  mailFrom: string | null;
  mailEnabled: boolean;
  inboundEnabled: boolean;
  limitsJson: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  lastJobAt: string | null;
}
export async function readCommercialWorkspace(id: string, database = db()) {
  return database
    .prepare('SELECT * FROM "workspaceProfiles" WHERE "workspaceId"=$1')
    .bind(id)
    .first<CommercialWorkspace>();
}
export async function assertWorkspaceOperational(
  ownerId: string,
  query: Pick<PoolClient, 'query'>,
  allowSetup = false,
) {
  const profile = (
    await query.query(
      'SELECT o.id,p.state FROM organizations o LEFT JOIN "workspaceProfiles" p ON p."workspaceId"=o.id AND p."ownerId"=o."ownerId" WHERE o."ownerId"=$1',
      [ownerId],
    )
  ).rows[0];
  if (profile?.id === 'daybook') return;
  if (!profile?.state || (profile.state !== 'active' && !(allowSetup && profile.state === 'draft')))
    throw new ApiError(423, 'Este espacio está en incorporación o en pausa. Sus datos se conservan.');
}
/** Separate from quota row locks: readers must not upgrade a shared profile row
 * to FOR UPDATE when a quota trigger runs later in the same transaction. */
export async function lockWorkspaceState(query: Pick<PoolClient, 'query'>, ownerId: string, exclusive = false) {
  await query.query(
    `SELECT ${exclusive ? 'pg_advisory_xact_lock' : 'pg_advisory_xact_lock_shared'}(hashtextextended($1,0))`,
    [`commercial-workspace-state:${ownerId}`],
  );
}
/** Workers hold the same owner lock as pilot suspension. A paused pilot leaves
 * its queue intact and spends neither retries nor notification stage keys. */
export async function workspaceOperationalInTransaction(ownerId: string, query: Pick<PoolClient, 'query'>) {
  const row = (
    await query.query(
      'SELECT o.id,p.state FROM organizations o LEFT JOIN "workspaceProfiles" p ON p."workspaceId"=o.id AND p."ownerId"=o."ownerId" WHERE o."ownerId"=$1',
      [ownerId],
    )
  ).rows[0];
  return Boolean(row && (row.id === 'daybook' || row.state === 'active'));
}
export async function requireOperator(request: Request, fresh = false) {
  const user = await auth(request);
  if (!operatorGranted(user)) throw new ApiError(403, 'Esta consola requiere una concesión explícita de operador.');
  const state = await readIdentitySecurity({ ownerId: '', userId: user.userId, sessionId: user.sessionId });
  const mfaAt = Date.parse(state.proof.mfaVerifiedAt || '');
  if (
    !state.enabled ||
    !state.recoveryAcknowledgedAt ||
    !Number.isFinite(mfaAt) ||
    mfaAt > Date.now() ||
    (fresh && !hasFreshProof(state.proof, true))
  )
    throw new ApiError(
      428,
      'Verifica el autenticador y la custodia de recuperación del operador.',
      '/account/security',
    );
  return user;
}
export async function listIdentityWorkspaces(request: Request) {
  const user = await auth(request);
  const rows = (
    await db()
      .prepare(
        `SELECT o.id,o.name,m.role,m.id AS "memberId",COALESCE(p.state,'active') AS state,COALESCE(p."brandName",o.name) AS "brandName"
    FROM members m JOIN organizations o ON o.id=m."organizationId" AND o."ownerId"=m."ownerId"
    LEFT JOIN "workspaceProfiles" p ON p."workspaceId"=o.id WHERE m."userId"=$1 AND m.status='active' ORDER BY o.name,o.id`,
      )
      .bind(user.userId)
      .all()
  ).results;
  return { workspaces: rows, operator: operatorGranted(user) };
}
export async function workspaceOnboarding(access: AccessContext) {
  const [profile, state, owner, settings] = await Promise.all([
    readCommercialWorkspace(access.organizationId),
    readIdentitySecurity(access),
    db()
      .prepare(
        `SELECT m.name,u."twoFactorEnabled",p."recoveryAcknowledgedAt" FROM members m JOIN "authUser" u ON u.id=m."userId" LEFT JOIN "securityProfiles" p ON p."userId"=u.id WHERE m."ownerId"=$1 AND m.role='owner' AND m.status='active'`,
      )
      .bind(access.ownerId)
      .first(),
    getSettings(access.ownerId),
  ]);
  return {
    profile: profile
      ? { ...profile, limits: limitsSchema.parse(JSON.parse(profile.limitsJson)), limitsJson: undefined }
      : null,
    brandName: profile?.brandName || settings.brandName,
    ownerReady: Boolean(owner?.twoFactorEnabled && owner?.recoveryAcknowledgedAt),
    securityRequired: state.policy.requireStaffMfa,
    mailVerified: profile ? verifiedWorkspaceSender(profile.workspaceId, profile.mailFrom) : true,
    canConfigure: ['owner', 'admin'].includes(access.role),
  };
}
/** No tickets, messages, customer contacts, files, credentials or membership grants are returned to operators. */
export async function listPlatformWorkspaces(database = db()) {
  return (
    await database
      .prepare(
        `SELECT p."workspaceId",p.state,p."brandName",p."mailEnabled",p."inboundEnabled",p."limitsJson",p.version,p."createdAt",p."updatedAt",p."lastJobAt",
    (SELECT count(*)::int FROM members m WHERE m."ownerId"=p."ownerId" AND m.status<>'revoked') AS members,
    (SELECT count(*)::int FROM tickets t WHERE t."ownerId"=p."ownerId" AND left(t."createdAt",7)=to_char(now() AT TIME ZONE 'UTC','YYYY-MM')) AS "ticketsMonthly",
    (SELECT count(*)::int FROM messages m WHERE m."ownerId"=p."ownerId" AND left(m."createdAt",7)=to_char(now() AT TIME ZONE 'UTC','YYYY-MM')) AS "messagesMonthly",
    (SELECT COALESCE(sum(a.size),0)::text FROM attachments a WHERE a."ownerId"=p."ownerId" AND a.status<>'deleted') AS "storageBytes",
    (SELECT count(*)::int FROM "mailOutbox" m WHERE m."ownerId"=p."ownerId" AND left(m."createdAt",7)=to_char(now() AT TIME ZONE 'UTC','YYYY-MM')) AS "mailMonthly"
    FROM "workspaceProfiles" p ORDER BY p."createdAt",p."workspaceId" LIMIT 100`,
      )
      .all()
  ).results.map(row => ({
    ...row,
    limits: limitsSchema.parse(JSON.parse(String(row.limitsJson))),
    limitsJson: undefined,
  }));
}
type OperatorActor = { userId: string; fullName?: string; email: string };
async function auditPilot(tx: PoolClient, ownerId: string, workspaceId: string, actor: OperatorActor | undefined) {
  if (!actor) return;
  await tx.query(
    `INSERT INTO "securityAudit"(id,"ownerId","actorMemberId","actorUserId","actorName",action,"targetId","createdAt") VALUES($1,$2,NULL,$3,$4,'configuration_changed',$5,$6)`,
    [randomUUID(), ownerId, actor.userId, actor.fullName || 'Operación Daybook', workspaceId, new Date().toISOString()],
  );
}
export async function createPilot(
  input: { name: string; ownerName: string; ownerEmail: string; limits: unknown },
  database = db(),
  actor?: OperatorActor,
) {
  const workspaceId = randomUUID(),
    ownerId = randomUUID(),
    memberId = randomUUID(),
    now = new Date().toISOString(),
    limits = limitsSchema.parse(input.limits ?? DEFAULT_PILOT_LIMITS);
  const invitation = await prepareInvitation(database, ownerId, memberId);
  await database.transaction(async tx => {
    await tx.query('INSERT INTO organizations(id,"ownerId",name,"createdAt") VALUES($1,$2,$3,$4)', [
      workspaceId,
      ownerId,
      input.name,
      now,
    ]);
    await tx.query(
      'INSERT INTO "workspaceProfiles"("workspaceId","ownerId",state,"brandName","limitsJson","createdAt","updatedAt") VALUES($1,$2,\'draft\',$3,$4,$5,$5)',
      [workspaceId, ownerId, input.name, JSON.stringify(limits), now],
    );
    await tx.query(
      `INSERT INTO members(id,"organizationId","ownerId",name,email,role,status,"createdAt","updatedAt") VALUES($1,$2,$3,$4,$5,'owner','invited',$6,$6)`,
      [memberId, workspaceId, ownerId, input.ownerName, input.ownerEmail.toLowerCase(), now],
    );
    await database.execute(invitation.statement, tx);
    await auditPilot(tx, ownerId, workspaceId, actor);
    // Invites remain copyable when the pilot has not configured a verified sender.
    for (const statement of notificationStatements(database, {
      ownerId,
      event: 'invitation',
      eventKey: `pilot:${memberId}`,
      recipientMemberId: memberId,
      actionUrl: invitation.url,
      expiresAt: invitation.expiresAt,
    }))
      await database.execute(statement, tx);
  });
  return { workspaceId, state: 'draft', invitationUrl: invitation.url };
}
async function lockPilot(tx: PoolClient, id: string) {
  const identity = (
    await tx.query<{ ownerId: string }>('SELECT "ownerId" FROM "workspaceProfiles" WHERE "workspaceId"=$1', [id])
  ).rows[0];
  if (!identity) return null;
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`daybook-ticket-work:${identity.ownerId}`]);
  await lockWorkspaceState(tx, identity.ownerId, true);
  return (
    (await tx.query<CommercialWorkspace>('SELECT * FROM "workspaceProfiles" WHERE "workspaceId"=$1 FOR UPDATE', [id]))
      .rows[0] ?? null
  );
}
export async function renewPilotOwnerInvitation(
  id: string,
  expectedVersion: number,
  database = db(),
  actor?: OperatorActor,
) {
  return database.transaction(async tx => {
    const profile = await lockPilot(tx, id);
    if (!profile || profile.state !== 'draft')
      throw new ApiError(409, 'Solo puede renovarse el acceso inicial de un piloto en borrador.');
    if (profile.version !== expectedVersion) throw new ApiError(409, 'El piloto cambió. Actualiza antes de renovar.');
    const owner = (
      await tx.query(
        'SELECT id FROM members WHERE "ownerId"=$1 AND role=\'owner\' AND status=\'invited\' AND "userId" IS NULL FOR UPDATE',
        [profile.ownerId],
      )
    ).rows[0];
    if (!owner) throw new ApiError(409, 'El propietario ya activó su identidad. Utilizará su recuperación personal.');
    const invitation = await prepareInvitation(database, profile.ownerId, owner.id),
      now = new Date().toISOString();
    await database.execute(invitation.statement, tx);
    await tx.query(
      'UPDATE "mailOutbox" SET status=\'cancelled\',"updatedAt"=$1 WHERE "ownerId"=$2 AND "recipientMemberId"=$3 AND event=\'invitation\' AND status IN (\'queued\',\'awaiting_configuration\')',
      [now, profile.ownerId, owner.id],
    );
    await tx.query('UPDATE "workspaceProfiles" SET version=version+1,"updatedAt"=$1 WHERE "workspaceId"=$2', [now, id]);
    await auditPilot(tx, profile.ownerId, id, actor);
    return { invitationUrl: invitation.url };
  });
}
export async function changePilot(
  id: string,
  input: {
    state?: CommercialWorkspace['state'];
    limits?: unknown;
    expectedVersion: number;
    capacityConfirmed?: boolean;
  },
  database = db(),
  capacity = parsePilotCapacity(),
  actor?: OperatorActor,
) {
  return database.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['commercial-workspace-capacity']);
    const profile = await lockPilot(tx, id);
    if (!profile) throw new ApiError(404, 'El piloto no existe.');
    if (profile.version !== input.expectedVersion) throw new ApiError(409, 'El piloto cambió. Actualiza la consola.');
    if ((input.state ?? profile.state) === 'active') {
      const features = (
        await tx.query('SELECT "featuresJson" FROM "evolutionFeatures" WHERE "ownerId"=$1', [profile.ownerId])
      ).rows[0];
      let flags: Record<string, unknown> = {};
      try {
        flags = JSON.parse(features?.featuresJson || '{}');
      } catch {}
      const ready = (
        await tx.query(
          `SELECT m.id FROM members m JOIN "authUser" u ON u.id=m."userId" JOIN "securityProfiles" r ON r."userId"=u.id JOIN "securityPolicies" p ON p."ownerId"=m."ownerId" WHERE m."ownerId"=$1 AND m.role='owner' AND m.status='active' AND u."twoFactorEnabled"=true AND r."recoveryAcknowledgedAt" IS NOT NULL AND p."requireStaffMfa"=true`,
          [profile.ownerId],
        )
      ).rows[0];
      if (!ready || flags.security !== true || flags.workspaces !== true)
        throw new ApiError(
          409,
          'El propietario debe completar MFA y recuperación, exigir MFA al equipo y preparar Seguridad y Espacios antes de activar el piloto.',
        );
    }
    const limits = input.limits ? limitsSchema.parse(input.limits) : JSON.parse(profile.limitsJson);
    if ((input.state ?? profile.state) === 'active') {
      if (!input.capacityConfirmed || !capacity)
        throw new ApiError(
          409,
          'El operador debe revisar la cuota disponible y configurar un presupuesto privado para los pilotos, sin cambiar planes.',
        );
      const occupied = (
        await tx.query(
          `SELECT p.state,p."limitsJson",COALESCE((SELECT sum(a.size) FROM attachments a WHERE a."ownerId"=p."ownerId" AND a.status<>'deleted'),0)::text AS bytes FROM "workspaceProfiles" p WHERE p."workspaceId"<>$1`,
          [id],
        )
      ).rows;
      const others = occupied
        .filter(row => row.state === 'active')
        .map(row => {
          const limit = limitsSchema.parse(JSON.parse(row.limitsJson));
          return { ...limit, storageBytes: Math.max(limit.storageBytes, Number(row.bytes)) };
        });
      const dormantBytes = occupied
        .filter(row => row.state !== 'active')
        .reduce((sum, row) => sum + Number(row.bytes), 0);
      const ownBytes = Number(
        (
          await tx.query(
            'SELECT COALESCE(sum(size),0)::text AS bytes FROM attachments WHERE "ownerId"=$1 AND status<>\'deleted\'',
            [profile.ownerId],
          )
        ).rows[0].bytes,
      );
      if (
        !fitsPilotCapacity([...others, { ...limits, storageBytes: Math.max(limits.storageBytes, ownBytes) }], {
          ...capacity,
          storageBytes: capacity.storageBytes - dormantBytes,
        })
      )
        throw new ApiError(409, 'Los límites acordados superan la capacidad reservada para pilotos.');
    }
    await tx.query(
      'UPDATE "workspaceProfiles" SET state=$2,"limitsJson"=$3,version=version+1,"updatedAt"=$4 WHERE "workspaceId"=$1',
      [id, input.state ?? profile.state, JSON.stringify(limits), new Date().toISOString()],
    );
    await auditPilot(tx, profile.ownerId, id, actor);
    return { updated: true };
  });
}
export async function configureWorkspace(
  access: AccessContext,
  input: {
    brandName: string;
    mailFrom: string | null;
    mailEnabled: boolean;
    inboundEnabled: boolean;
    expectedVersion: number;
  },
  database = db(),
) {
  return database.transaction(async tx => {
    const { lockAccess } = await import('./ticket-mutations'),
      { requireFreshSecurity } = await import('./security');
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`daybook-ticket-work:${access.ownerId}`]);
    const fresh = await lockAccess(tx, access);
    if (!['owner', 'admin'].includes(fresh.role))
      throw new ApiError(403, 'Solo administración puede configurar el negocio.');
    await requireFreshSecurity(fresh, tx);
    const row = (
      await tx.query<CommercialWorkspace>(
        'SELECT * FROM "workspaceProfiles" WHERE "workspaceId"=$1 AND "ownerId"=$2 FOR UPDATE',
        [access.organizationId, access.ownerId],
      )
    ).rows[0];
    if (!row) throw new ApiError(400, 'La configuración de Daybook se conserva en sus ajustes actuales.');
    if (row.version !== input.expectedVersion) throw new ApiError(409, 'La configuración cambió.');
    if ((input.mailEnabled || input.inboundEnabled) && !verifiedWorkspaceSender(row.workspaceId, input.mailFrom))
      throw new ApiError(
        409,
        'El operador debe comprobar este remitente con el proveedor y autorizarlo de forma privada.',
      );
    await tx.query(
      'UPDATE "workspaceProfiles" SET "brandName"=$3,"mailFrom"=$4,"mailEnabled"=$5,"inboundEnabled"=$6,version=version+1,"updatedAt"=$7 WHERE "workspaceId"=$1 AND "ownerId"=$2',
      [
        access.organizationId,
        access.ownerId,
        input.brandName,
        input.mailFrom,
        input.mailEnabled,
        input.inboundEnabled,
        new Date().toISOString(),
      ],
    );
    await recordSecurityEvent(tx, fresh, 'configuration_changed');
    return { updated: true };
  });
}
export async function transferWorkspaceOwner(access: AccessContext, targetId: string, database = db()) {
  return database.transaction(async tx => {
    const { lockAccess } = await import('./ticket-mutations'),
      { requireFreshSecurity } = await import('./security');
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`daybook-ticket-work:${access.ownerId}`]);
    const fresh = await lockAccess(tx, access);
    if (fresh.role !== 'owner') throw new ApiError(403, 'Solo el propietario puede transferir su rol.');
    await requireFreshSecurity(fresh, tx);
    const target = (
      await tx.query(
        `SELECT m.* FROM members m JOIN "authUser" u ON u.id=m."userId" JOIN "securityProfiles" p ON p."userId"=u.id WHERE m.id=$1 AND m."ownerId"=$2 AND m.status='active' AND m.role IN ('admin','agent') AND u."twoFactorEnabled"=true AND p."recoveryAcknowledgedAt" IS NOT NULL FOR UPDATE OF m`,
        [targetId, access.ownerId],
      )
    ).rows[0];
    if (!target) throw new ApiError(400, 'Selecciona una cuenta activa del equipo con MFA y recuperación verificados.');
    await tx.query('UPDATE members SET role=\'admin\',"updatedAt"=$2 WHERE id=$1', [
      fresh.member.id,
      new Date().toISOString(),
    ]);
    await tx.query('UPDATE members SET role=\'owner\',"updatedAt"=$2 WHERE id=$1', [
      target.id,
      new Date().toISOString(),
    ]);
    await recordSecurityEvent(tx, fresh, 'member_permissions_changed', target.id);
    return { transferred: true };
  });
}
export async function activeWorkspaceOwners(database = db()) {
  return (
    await database
      .prepare(
        `SELECT o."ownerId",o.id FROM organizations o LEFT JOIN "workspaceProfiles" p ON p."workspaceId"=o.id WHERE o.id='daybook' OR p.state='active' ORDER BY COALESCE(p."lastJobAt",'') ASC,o.id LIMIT 20`,
      )
      .all<{ ownerId: string; id: string }>()
  ).results;
}
