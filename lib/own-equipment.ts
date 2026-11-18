/**
 * «Confirma tu equipo» (Fase 7, L4): a client registers their own equipment when they have none, or adds the serial
 * number (and the make and model) to equipment that was registered without it. A client never takes, changes or
 * learns about anyone else's equipment: an ID or serial already in use is answered with a generic message, and
 * correcting data that is already there is the team's job, from a ticket.
 */
import type { AccessContext } from './access';
import { assertSerialAvailable, assignInviteEquipment, recordEquipmentEvent } from './client-equipment';
import { assetTagProblem, normalizeAssetTag } from './asset-tag';
import {
  normalizeModel,
  normalizeSerial,
  OWN_EQUIPMENT_MESSAGES,
  serialProblem,
  type InviteEquipment,
} from './client-equipment-model';
import { ApiError, db } from './server';
import { lockAccess } from './ticket-mutations';
import { acquireTicketWorkLock } from './work-lock';
import type { PoolClient } from 'pg';

export function requireActiveClient(access: AccessContext): AccessContext {
  if (access.role !== 'client' || access.member.status !== 'active')
    throw new ApiError(403, 'Esta acción está disponible solo para clientes con acceso.');
  return access;
}

async function clientTransaction<T>(access: AccessContext, work: (tx: PoolClient, fresh: AccessContext) => Promise<T>) {
  requireActiveClient(access);
  return db().transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    return work(tx, requireActiveClient(await lockAccess(tx, access)));
  });
}

/** 409 from the shared checks names other equipment; the client gets the generic message instead. */
async function asClient<T>(work: Promise<T>, message: string): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) throw new ApiError(409, message);
    throw error;
  }
}

export async function registerOwnEquipment(access: AccessContext, input: InviteEquipment) {
  const problem = assetTagProblem(input.assetTag) ?? serialProblem(input.serial);
  if (problem) throw new ApiError(400, problem);
  const tag = normalizeAssetTag(input.assetTag);
  return clientTransaction(access, async (tx, fresh) => {
    const companyId = fresh.member.customerCompanyId;
    if (!companyId) throw new ApiError(400, OWN_EQUIPMENT_MESSAGES.noCompany);
    const mine = await tx.query(
      'SELECT 1 FROM "customerAssets" WHERE "ownerId"=$1 AND "assignedContactMemberId"=$2 AND archived=false LIMIT 1',
      [fresh.ownerId, fresh.member.id],
    );
    if (mine.rows.length) throw new ApiError(409, OWN_EQUIPMENT_MESSAGES.alreadyHasEquipment);
    const taken = await tx.query('SELECT 1 FROM "customerAssets" WHERE "ownerId"=$1 AND "assetTag"=$2', [
      fresh.ownerId,
      tag,
    ]);
    if (taken.rows.length) throw new ApiError(409, OWN_EQUIPMENT_MESSAGES.tagTaken(tag));
    const now = new Date().toISOString();
    const created = await asClient(
      assignInviteEquipment(tx, {
        ownerId: fresh.ownerId,
        companyId,
        memberId: fresh.member.id,
        actorMemberId: fresh.member.id,
        equipment: { ...input, assetTag: tag },
        now,
      }),
      OWN_EQUIPMENT_MESSAGES.serialTaken,
    );
    return { id: created.id, assetTag: created.assetTag };
  });
}

export async function completeOwnEquipment(
  access: AccessContext,
  id: string,
  input: { serial: string; model?: string },
) {
  const problem = serialProblem(input.serial);
  if (problem) throw new ApiError(400, problem);
  const serial = normalizeSerial(input.serial),
    model = normalizeModel(input.model);
  return clientTransaction(access, async (tx, fresh) => {
    const before = (
      await tx.query<Record<string, unknown> & { serial: string; companyId: string; assetTag: string | null }>(
        `SELECT * FROM "customerAssets"
          WHERE id=$1 AND "ownerId"=$2 AND "assignedContactMemberId"=$3 AND archived=false FOR UPDATE`,
        [id, fresh.ownerId, fresh.member.id],
      )
    ).rows[0];
    if (!before) throw new ApiError(404, 'Ese equipo no está asignado a tu cuenta.');
    if (normalizeSerial(before.serial)) throw new ApiError(409, OWN_EQUIPMENT_MESSAGES.alreadyComplete);
    await asClient(
      assertSerialAvailable(tx, { ownerId: fresh.ownerId, serial, exceptId: id }),
      OWN_EQUIPMENT_MESSAGES.serialTaken,
    );
    const now = new Date().toISOString();
    const after = (
      await tx.query(
        `UPDATE "customerAssets" SET serial=$2, model=CASE WHEN btrim(model)='' THEN $3 ELSE model END,
                version=version+1, "updatedAt"=$4
          WHERE id=$1 RETURNING *`,
        [id, serial, model, now],
      )
    ).rows[0];
    await recordEquipmentEvent(
      tx,
      { ownerId: fresh.ownerId, companyId: before.companyId, actorMemberId: fresh.member.id, now },
      id,
      before,
      after,
    );
    return { id, assetTag: before.assetTag, serial };
  });
}
