import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApiError, isSerialConflict } from './server';
import { normalizeAssetTag } from './asset-tag';
import {
  duplicateSerialProblem,
  equipmentKindLabel,
  existingEquipmentProblem,
  normalizeModel,
  normalizeSerial,
  serialMismatchProblem,
  serialProblem,
  type InviteEquipment,
} from './client-equipment-model';

type Row = {
  id: string;
  companyId: string;
  archived: boolean;
  assignedName: string | null;
  serial: string;
  model: string;
};

/**
 * Throws 409 when another piece of equipment of the workspace already has this serial number. There is no unique
 * index on `serial` (older rows may repeat or lack it), so this check runs inside the caller's transaction, which holds
 * the workspace work lock that serializes equipment writes.
 */
export async function assertSerialAvailable(
  tx: PoolClient,
  input: { ownerId: string; serial: string; exceptId?: string | null },
): Promise<void> {
  const other = (
    await tx.query<{ assetTag: string | null; archived: boolean }>(
      `SELECT "assetTag", archived FROM "customerAssets"
        WHERE "ownerId"=$1 AND upper(regexp_replace(btrim(serial), '\\s+', ' ', 'g'))=$2 AND ($3::text IS NULL OR id<>$3)
        ORDER BY archived, "createdAt" LIMIT 1`,
      [input.ownerId, input.serial, input.exceptId ?? null],
    )
  ).rows[0];
  if (other) throw new ApiError(409, duplicateSerialProblem(input.serial, other));
}

/**
 * Inside the invitation's transaction (which already holds the workspace work lock): records the client's equipment
 * by its inventory ID, or assigns an existing, unassigned one of the same company. Never takes equipment from someone:
 * reassigning is a separate, explicit action. The serial number is required: an existing piece without one gets it,
 * one with a different serial is refused. Leaves an entry in the service-context history.
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
  const problem = serialProblem(input.equipment.serial);
  if (problem) throw new ApiError(400, problem);
  const serial = normalizeSerial(input.equipment.serial),
    model = normalizeModel(input.equipment.model);
  const current = (
    await tx.query<Row>(
      `SELECT a.id, a."companyId", a.archived, a.serial, a.model, m.name AS "assignedName"
         FROM "customerAssets" a
         LEFT JOIN members m ON m.id = a."assignedContactMemberId" AND m."ownerId" = a."ownerId" AND m.status <> 'revoked'
        WHERE a."ownerId" = $1 AND a."assetTag" = $2
        FOR UPDATE OF a`,
      [input.ownerId, tag],
    )
  ).rows[0];
  if (current) {
    const problem =
      existingEquipmentProblem(tag, current, input.companyId) ?? serialMismatchProblem(tag, current.serial, serial);
    if (problem) throw new ApiError(409, problem);
    if (!normalizeSerial(current.serial))
      await assertSerialAvailable(tx, { ownerId: input.ownerId, serial, exceptId: current.id });
    const before = (await tx.query('SELECT * FROM "customerAssets" WHERE id=$1', [current.id])).rows[0];
    const after = (
      await tx.query(
        `UPDATE "customerAssets" SET "assignedContactMemberId"=$2, version=version+1, "updatedAt"=$3,
                serial=CASE WHEN btrim(serial)='' THEN $4 ELSE serial END,
                model=CASE WHEN btrim(model)='' THEN $5 ELSE model END
          WHERE id=$1 RETURNING *`,
        [current.id, input.memberId, input.now, serial, model],
      )
    ).rows[0];
    await recordEquipmentEvent(tx, input, current.id, before, after);
    return { id: current.id, assetTag: tag, created: false };
  }
  await assertSerialAvailable(tx, { ownerId: input.ownerId, serial });
  const id = randomUUID(),
    label = equipmentKindLabel(input.equipment.kind);
  let row: unknown;
  try {
    row = (
      await tx.query(
        `INSERT INTO "customerAssets" (id,"ownerId","companyId",name,category,serial,model,"assetTag","assignedContactMemberId","reminderBaselineAt","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$10) RETURNING *`,
        [id, input.ownerId, input.companyId, `${label} ${tag}`, label, serial, model, tag, input.memberId, input.now],
      )
    ).rows[0];
  } catch (error) {
    // The work lock serializes invitations, so this only guards a write from elsewhere.
    if ((error as { code?: string }).code === '23505' && !isSerialConflict(error))
      throw new ApiError(409, `El equipo ${tag} ya está registrado. Intenta de nuevo.`);
    throw error;
  }
  await recordEquipmentEvent(tx, input, id, null, row);
  return { id, assetTag: tag, created: true };
}

/** History entry for an equipment change, in the same format as the service-context screens. */
export async function recordEquipmentEvent(
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
