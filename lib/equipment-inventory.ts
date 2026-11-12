import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { requireStaff, type AccessContext } from './access';
import { assetTagProblem, normalizeAssetTag } from './asset-tag';
import { recordEquipmentEvent } from './client-equipment';
import {
  assigneeProblem,
  equipmentKindLabel,
  type EquipmentClient,
  type EquipmentFilter,
  type EquipmentInventory,
  type EquipmentItem,
} from './client-equipment-model';
import { lockAccess } from './ticket-mutations';
import { ApiError, db } from './server';
import { acquireTicketWorkLock } from './work-lock';

/** At most this many rows are listed; the search narrows it. Inventories in one workspace are expected to be small. */
export const EQUIPMENT_LIST_LIMIT = 500;

/**
 * The staff inventory: active equipment of this workspace (archived ones are left out), the clients it can go to,
 * and the clients that still have none. Uses the same table as "Empresas y servicios" but does not need that
 * function to be on.
 */
export async function listEquipment(
  access: AccessContext,
  options: { query?: string; filter?: EquipmentFilter } = {},
): Promise<EquipmentInventory> {
  requireStaff(access);
  const database = db(),
    query = (options.query ?? '').trim().slice(0, 120),
    pattern = query ? `%${query.replace(/[\\%_]/g, character => `\\${character}`)}%` : null,
    filter = options.filter ?? 'all';
  const equipment = (
    await database
      .prepare(
        `SELECT a.id, a."assetTag", a.name, a.category, a.serial, a."companyId", c.name AS "companyName",
                m.id AS "assignedMemberId", m.name AS "assignedName", a.version, a."updatedAt"
           FROM "customerAssets" a
           JOIN "customerCompanies" c ON c.id = a."companyId" AND c."ownerId" = a."ownerId"
           LEFT JOIN members m ON m.id = a."assignedContactMemberId" AND m."ownerId" = a."ownerId" AND m.status <> 'revoked'
          WHERE a."ownerId" = $1 AND a.archived = false
            AND ($2::text IS NULL OR a."assetTag" ILIKE $2 OR a.name ILIKE $2 OR a.serial ILIKE $2 OR m.name ILIKE $2 OR c.name ILIKE $2)
            AND ($3 = 'all' OR ($3 = 'unassigned' AND m.id IS NULL) OR ($3 = 'assigned' AND m.id IS NOT NULL))
          ORDER BY a."assetTag" NULLS LAST, a.name, a.id
          LIMIT ${EQUIPMENT_LIST_LIMIT}`,
      )
      .bind(access.ownerId, pattern, filter)
      .all<EquipmentItem>()
  ).results;
  const clients = (
    await database
      .prepare(
        `SELECT m.id, m.name, m.email, m."customerCompanyId" AS "companyId", c.name AS "companyName",
                EXISTS (SELECT 1 FROM "customerAssets" a
                         WHERE a."ownerId" = m."ownerId" AND a."assignedContactMemberId" = m.id AND a.archived = false) AS "hasEquipment"
           FROM members m
           LEFT JOIN "customerCompanies" c ON c.id = m."customerCompanyId" AND c."ownerId" = m."ownerId"
          WHERE m."ownerId" = $1 AND m."organizationId" = $2 AND m.role = 'client' AND m.status <> 'revoked'
          ORDER BY m.name, m.email`,
      )
      .bind(access.ownerId, access.organizationId)
      .all<EquipmentClient & { hasEquipment: boolean }>()
  ).results;
  const plain = (row: EquipmentClient & { hasEquipment: boolean }): EquipmentClient => ({
    id: row.id,
    name: row.name,
    email: row.email,
    companyId: row.companyId,
    companyName: row.companyName,
  });
  return {
    equipment,
    clients: clients.filter(client => client.companyId).map(plain),
    clientsWithoutEquipment: clients.filter(client => !client.hasEquipment).map(plain),
  };
}

type MemberTarget = { role: string; status: string; customerCompanyId: string | null };
async function readAssignee(tx: PoolClient, access: AccessContext, memberId: string | null | undefined) {
  if (!memberId) return null;
  return (
    (
      await tx.query<MemberTarget & { name: string }>(
        'SELECT role, status, "customerCompanyId", name FROM members WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3',
        [memberId, access.ownerId, access.organizationId],
      )
    ).rows[0] ?? null
  );
}
async function writeTransaction<T>(access: AccessContext, work: (tx: PoolClient, fresh: AccessContext) => Promise<T>) {
  return db().transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh = requireStaff(await lockAccess(tx, access));
    return work(tx, fresh);
  });
}

/** Records a piece of equipment by its inventory ID, optionally assigned to a client of its company. */
export async function createEquipment(
  access: AccessContext,
  input: { companyId: string; assetTag: string; kind: string; serial?: string; assignedMemberId?: string | null },
): Promise<EquipmentItem> {
  requireStaff(access);
  const tagProblem = assetTagProblem(input.assetTag);
  if (tagProblem) throw new ApiError(400, tagProblem);
  const tag = normalizeAssetTag(input.assetTag);
  return writeTransaction(access, async (tx, fresh) => {
    const company = (
      await tx.query<{ name: string }>(
        'SELECT name FROM "customerCompanies" WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3',
        [input.companyId, fresh.ownerId, fresh.organizationId],
      )
    ).rows[0];
    if (!company) throw new ApiError(400, 'Selecciona una empresa de este espacio.');
    const existing = (
      await tx.query('SELECT 1 FROM "customerAssets" WHERE "ownerId"=$1 AND "assetTag"=$2', [fresh.ownerId, tag])
    ).rows[0];
    if (existing) throw new ApiError(409, `El equipo ${tag} ya está registrado. Búscalo en la lista para asignarlo.`);
    const assignee = await readAssignee(tx, fresh, input.assignedMemberId);
    if (input.assignedMemberId) {
      const problem = assigneeProblem(assignee, input.companyId);
      if (problem) throw new ApiError(400, problem);
    }
    const id = randomUUID(),
      now = new Date().toISOString(),
      label = equipmentKindLabel(input.kind);
    let row: Record<string, unknown>;
    try {
      row = (
        await tx.query(
          `INSERT INTO "customerAssets" (id,"ownerId","companyId",name,category,serial,"assetTag","assignedContactMemberId","reminderBaselineAt","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9) RETURNING *`,
          [
            id,
            fresh.ownerId,
            input.companyId,
            `${label} ${tag}`,
            label,
            input.serial ?? '',
            tag,
            input.assignedMemberId ?? null,
            now,
          ],
        )
      ).rows[0];
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ApiError(409, `El equipo ${tag} ya está registrado. Vuelve a intentarlo.`);
      throw error;
    }
    await recordEquipmentEvent(
      tx,
      { ownerId: fresh.ownerId, companyId: input.companyId, actorMemberId: fresh.member.id, now },
      id,
      null,
      row,
    );
    return {
      id,
      assetTag: tag,
      name: String(row.name),
      category: String(row.category),
      serial: String(row.serial),
      companyId: input.companyId,
      companyName: company.name,
      assignedMemberId: input.assignedMemberId ?? null,
      assignedName: assignee?.name ?? null,
      version: Number(row.version),
      updatedAt: now,
    };
  });
}

/**
 * Assigns equipment to a client of its company, or frees it (null). Optimistic: the version the person saw must
 * still be the current one, so two people changing the same equipment never overwrite each other silently.
 */
export async function assignEquipment(
  access: AccessContext,
  id: string,
  input: { expectedVersion: number; assignedMemberId: string | null },
): Promise<{ id: string; version: number; assignedMemberId: string | null; assignedName: string | null }> {
  requireStaff(access);
  return writeTransaction(access, async (tx, fresh) => {
    const before = (
      await tx.query<
        Record<string, unknown> & { companyId: string; version: number; assignedContactMemberId: string | null }
      >('SELECT * FROM "customerAssets" WHERE id=$1 AND "ownerId"=$2 AND archived=false FOR UPDATE', [
        id,
        fresh.ownerId,
      ])
    ).rows[0];
    if (!before) throw new ApiError(404, 'Ese equipo no existe en este espacio o fue dado de baja.');
    if (Number(before.version) !== input.expectedVersion)
      throw new ApiError(409, 'Alguien cambió este equipo hace un momento. Actualiza la lista y vuelve a intentarlo.');
    const assignee = await readAssignee(tx, fresh, input.assignedMemberId);
    if (input.assignedMemberId) {
      const problem = assigneeProblem(assignee, before.companyId);
      if (problem) throw new ApiError(400, problem);
    }
    if ((before.assignedContactMemberId ?? null) === input.assignedMemberId)
      return {
        id,
        version: Number(before.version),
        assignedMemberId: input.assignedMemberId,
        assignedName: assignee?.name ?? null,
      };
    const now = new Date().toISOString();
    const after = (
      await tx.query(
        'UPDATE "customerAssets" SET "assignedContactMemberId"=$2, version=version+1, "updatedAt"=$3 WHERE id=$1 RETURNING *',
        [id, input.assignedMemberId, now],
      )
    ).rows[0];
    await recordEquipmentEvent(
      tx,
      { ownerId: fresh.ownerId, companyId: before.companyId, actorMemberId: fresh.member.id, now },
      id,
      before,
      after,
    );
    return {
      id,
      version: Number(after.version),
      assignedMemberId: input.assignedMemberId,
      assignedName: assignee?.name ?? null,
    };
  });
}
