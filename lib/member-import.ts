/**
 * Bulk import of client employees with their equipment (Fase 7, L2). The checks are those of `lib/member-import-model.ts`;
 * this file loads what exists and writes. The import is all-or-nothing, in one transaction that holds the workspace work
 * lock (the same lock as a single invitation), and it never queues invitation mail: the admin hands out the links.
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { requireAdmin, type AccessContext } from './access';
import { assignInviteEquipment } from './client-equipment';
import { prepareInvitation } from './invitations';
import {
  checkImportRows,
  importReady,
  readImportFile,
  type ImportContext,
  type ImportedInvitation,
  type ImportPreview,
} from './member-import-model';
import { db } from './server';
import { lockAccess } from './ticket-mutations';
import { acquireTicketWorkLock } from './work-lock';

type Reader = Pick<PoolClient, 'query'>;

/** What exists for the rows of this file: only the emails, IDs and serials it names are read. */
export async function loadImportContext(
  reader: Reader,
  access: Pick<AccessContext, 'ownerId' | 'organizationId'>,
  preview: { emails: string[]; tags: string[]; serials: string[] },
  createMissingCompanies: boolean,
): Promise<ImportContext> {
  const companies = (
    await reader.query<{ id: string; name: string }>(
      'SELECT id, name FROM "customerCompanies" WHERE "ownerId"=$1 AND "organizationId"=$2 ORDER BY "createdAt", id',
      [access.ownerId, access.organizationId],
    )
  ).rows;
  const emails = (
    await reader.query<{ email: string }>(
      'SELECT lower(email) AS email FROM members WHERE "organizationId"=$1 AND lower(email) = ANY($2::text[])',
      [access.organizationId, preview.emails],
    )
  ).rows;
  const byTag = (
    await reader.query<{
      id: string;
      assetTag: string;
      companyId: string;
      archived: boolean;
      assignedName: string | null;
      serial: string;
    }>(
      `SELECT a.id, a."assetTag", a."companyId", a.archived, a.serial, m.name AS "assignedName"
         FROM "customerAssets" a
         LEFT JOIN members m ON m.id = a."assignedContactMemberId" AND m."ownerId" = a."ownerId" AND m.status <> 'revoked'
        WHERE a."ownerId"=$1 AND a."assetTag" = ANY($2::text[])`,
      [access.ownerId, preview.tags],
    )
  ).rows;
  const bySerial = (
    await reader.query<{ id: string; assetTag: string | null; archived: boolean; serial: string }>(
      `SELECT id, "assetTag", archived, upper(regexp_replace(btrim(serial), '\\s+', ' ', 'g')) AS serial
         FROM "customerAssets"
        WHERE "ownerId"=$1 AND upper(regexp_replace(btrim(serial), '\\s+', ' ', 'g')) = ANY($2::text[])
        ORDER BY archived, "createdAt"`,
      [access.ownerId, preview.serials],
    )
  ).rows;
  const equipmentBySerial = new Map<string, { id: string; assetTag: string | null; archived: boolean }>();
  for (const row of bySerial) if (!equipmentBySerial.has(row.serial)) equipmentBySerial.set(row.serial, row);
  return {
    companies,
    existingEmails: new Set(emails.map(row => row.email)),
    equipmentByTag: new Map(byTag.map(row => [row.assetTag, row])),
    equipmentBySerial,
    createMissingCompanies,
  };
}

async function check(reader: Reader, access: AccessContext, csv: string, createMissingCompanies: boolean) {
  const file = readImportFile(csv);
  // A first pass without context only collects the keys to look up; the real check runs with what exists.
  const keys = checkImportRows(file, {
    companies: [],
    existingEmails: new Set(),
    equipmentByTag: new Map(),
    equipmentBySerial: new Map(),
    createMissingCompanies: true,
  }).rows;
  const context = await loadImportContext(
    reader,
    access,
    {
      emails: keys.map(row => row.email).filter(Boolean),
      tags: keys.map(row => row.assetTag).filter(Boolean),
      serials: keys.map(row => row.serial).filter(Boolean),
    },
    createMissingCompanies,
  );
  return checkImportRows(file, context);
}

/** «Revisar archivo»: what would happen, row by row, without writing anything. */
export async function previewMemberImport(
  access: AccessContext,
  input: { csv: string; createMissingCompanies: boolean },
): Promise<ImportPreview> {
  requireAdmin(access);
  return db().transaction(tx => check(tx, access, input.csv, input.createMissingCompanies));
}

export type ImportResult =
  | { invitations: ImportedInvitation[]; expiresAt: string; companiesCreated: string[] }
  /** Nothing was written: a row stopped passing between the preview and the confirmation. */
  | { blocked: ImportPreview };

/**
 * «Crear invitaciones»: checks the file again inside the transaction (something may have changed since the preview)
 * and creates every company, member, invitation and equipment, or nothing. Answers 409 with the fresh preview when a
 * row no longer passes (the route answers 409 with it).
 */
export async function applyMemberImport(
  access: AccessContext,
  input: { csv: string; createMissingCompanies: boolean },
): Promise<ImportResult> {
  requireAdmin(access);
  const database = db();
  return database.transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh = requireAdmin(await lockAccess(tx, access));
    const preview = await check(tx, fresh, input.csv, input.createMissingCompanies);
    if (!importReady(preview)) return { blocked: preview };
    const now = new Date().toISOString(),
      companyIds = new Map<string, string>();
    for (const name of preview.summary.newCompanies) {
      const id = randomUUID();
      await tx.query(
        'INSERT INTO "customerCompanies" (id,"organizationId","ownerId",name,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$5)',
        [id, fresh.organizationId, fresh.ownerId, name, now],
      );
      companyIds.set(name, id);
    }
    const invitations: ImportedInvitation[] = [];
    let expiresAt = now;
    for (const row of preview.rows) {
      const companyId = row.companyId ?? companyIds.get(row.company);
      // A new company is named in the rows exactly as it was created (`checkImportRows`).
      if (!companyId || !row.kind) throw new Error('A checked import row lost its company or kind.');
      const id = randomUUID(),
        invitation = await prepareInvitation(database, fresh.ownerId, id);
      await tx.query(
        `INSERT INTO members (id,"organizationId","ownerId","userId",email,name,role,status,"invitedBy","createdAt","updatedAt","customerCompanyId","companyAccess","isTest")
         VALUES ($1,$2,$3,NULL,$4,$5,'client','invited',$6,$7,$7,$8,'own',false)`,
        [id, fresh.organizationId, fresh.ownerId, row.email, row.name, fresh.member.id, now, companyId],
      );
      await assignInviteEquipment(tx, {
        ownerId: fresh.ownerId,
        companyId,
        memberId: id,
        actorMemberId: fresh.member.id,
        equipment: { assetTag: row.assetTag, kind: row.kind, serial: row.serial, model: row.model },
        now,
      });
      await database.execute(invitation.statement, tx);
      expiresAt = invitation.expiresAt;
      invitations.push({
        name: row.name,
        email: row.email,
        company: row.company,
        assetTag: row.assetTag,
        url: invitation.url,
      });
    }
    return { invitations, expiresAt, companiesCreated: preview.summary.newCompanies };
  });
}
