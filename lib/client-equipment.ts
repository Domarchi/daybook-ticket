import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApiError } from './server';
import { normalizeAssetTag } from './asset-tag';
import { equipmentKindLabel, existingEquipmentProblem, type InviteEquipment } from './client-equipment-model';

type Row = { id: string; companyId: string; archived: boolean; assignedName: string | null };

/**
 * Inside the invitation's transaction (which already holds the workspace work lock): records the client's equipment
 * by its inventory ID, or assigns an existing, unassigned one of the same company. Never takes equipment from someone:
 * reassigning is a separate, explicit action. Leaves an entry in the service-context history.
 */
export async function assignInviteEquipment(
  tx: PoolClient,
  input: {
    ownerId: string;
    companyId: string;
    memberId: string;
    actorMemberId: string;
    equipment: InviteEquipment;
    now: string;
  },
): Promise<{ id: string; assetTag: string; created: boolean }> {
  const tag = normalizeAssetTag(input.equipment.assetTag);
  const current = (
    await tx.query<Row>(
      `SELECT a.id, a."companyId", a.archived, m.name AS "assignedName"
         FROM "customerAssets" a
         LEFT JOIN members m ON m.id = a."assignedContactMemberId" AND m."ownerId" = a."ownerId" AND m.status <> 'revoked'
        WHERE a."ownerId" = $1 AND a."assetTag" = $2
        FOR UPDATE OF a`,
      [input.ownerId, tag],
    )
  ).rows[0];
  if (current) {
    const problem = existingEquipmentProblem(tag, current, input.companyId);
    if (problem) throw new ApiError(409, problem);
    const before = (await tx.query('SELECT * FROM "customerAssets" WHERE id=$1', [current.id])).rows[0];
    const after = (
      await tx.query(
        'UPDATE "customerAssets" SET "assignedContactMemberId"=$2, version=version+1, "updatedAt"=$3 WHERE id=$1 RETURNING *',
        [current.id, input.memberId, input.now],
      )
    ).rows[0];
    await audit(tx, input, current.id, before, after);
    return { id: current.id, assetTag: tag, created: false };
  }
  const id = randomUUID(),
    label = equipmentKindLabel(input.equipment.kind);
  let row: unknown;
  try {
    row = (
      await tx.query(
        `INSERT INTO "customerAssets" (id,"ownerId","companyId",name,category,serial,"assetTag","assignedContactMemberId","reminderBaselineAt","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9) RETURNING *`,
        [
          id,
          input.ownerId,
          input.companyId,
          `${label} ${tag}`,
          label,
          input.equipment.serial ?? '',
          tag,
          input.memberId,
          input.now,
        ],
      )
    ).rows[0];
  } catch (error) {
    // The work lock serializes invitations, so this only guards a write from elsewhere.
    if ((error as { code?: string }).code === '23505')
      throw new ApiError(409, `El equipo ${tag} ya está registrado. Vuelve a intentarlo.`);
    throw error;
  }
  await audit(tx, input, id, null, row);
  return { id, assetTag: tag, created: true };
}

async function audit(
  tx: PoolClient,
  input: { ownerId: string; companyId: string; actorMemberId: string; now: string },
  id: string,
  before: unknown,
  after: unknown,
) {
  await tx.query(
    'INSERT INTO "serviceContextEvents" (id,"ownerId","companyId",resource,"resourceId","actorMemberId","beforeJson","afterJson","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      randomUUID(),
      input.ownerId,
      input.companyId,
      'assets',
      id,
      input.actorMemberId,
      before === null ? null : JSON.stringify(before),
      JSON.stringify(after),
      input.now,
    ],
  );
}
