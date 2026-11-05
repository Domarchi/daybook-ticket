import {acquireTicketWorkLock} from './work-lock';
import { workspaceApiPath } from './workspace-model';
import { randomUUID,createHash } from 'node:crypto';
import {parseEvolutionFeatures} from './evolution-feature-model';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Database } from '../db/database';
import { ApiError, db, getTicket } from './server';
import { lockAccess } from './ticket-mutations';
import { canAccessTicket, requireAdmin, requireStaff, type AccessContext } from './access';
import { attachmentFileInfo, AttachmentValidationError, MAX_ATTACHMENT_BYTES, validateAttachment } from './attachments-validation';
import { AttachmentSizeError, attachmentStorage, attachmentStorageConfig, readAttachmentBytes, type PrivateAttachmentStorage } from './attachments-storage';

export type AttachmentKind = 'request' | 'reply' | 'note' | 'contract';
export interface AttachmentRow {
  id: string; ownerId: string; memberId: string; draftId: string; ticketId: number | null; messageId: number | null; contractId?: string | null;
  kind: AttachmentKind; pathname: string; name: string; contentType: string; size: number;
  status: 'reserved' | 'uploaded' | 'ready' | 'attached' | 'deleting' | 'deleted';
  expiresAt: string; uploadedAt: string | null; validatedAt: string | null; createdAt: string; updatedAt: string;
}
export const attachmentScopeSchema = z.object({
  draftId: z.string().uuid(), kind: z.enum(['request', 'reply', 'note', 'contract']), ticketId: z.number().int().positive().optional(), contractId: z.string().uuid().optional(),
}).strict().refine(scope => scope.kind === 'contract' ? scope.contractId !== undefined && scope.ticketId === undefined : scope.contractId === undefined && (scope.kind === 'request' ? scope.ticketId === undefined : scope.ticketId !== undefined), 'Selecciona un único destino válido para el adjunto.');
export const reserveAttachmentSchema = z.object({
  draftId: z.string().uuid(), kind: z.enum(['request', 'reply', 'note', 'contract']), ticketId: z.number().int().positive().optional(), contractId: z.string().uuid().optional(),
  name: z.string().min(1).max(180), size: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES), contentType: z.string().max(150),
}).strict().refine(scope => scope.kind === 'contract' ? scope.contractId !== undefined && scope.ticketId === undefined : scope.contractId === undefined && (scope.kind === 'request' ? scope.ticketId === undefined : scope.ticketId !== undefined), 'Selecciona un único destino válido para el adjunto.');
type Scope = z.infer<typeof attachmentScopeSchema>;
export function publicAttachment(row: AttachmentRow) {
  return { id: row.id, name: row.name, contentType: row.contentType, size: row.size, status: row.status, expiresAt: row.expiresAt };
}
export function attachmentsConfigured() { return Boolean(attachmentStorageConfig()); }
function requireStorage() {
  if (!attachmentsConfigured()) throw new ApiError(503, 'Los adjuntos privados todavía no están configurados.');
  return attachmentStorage();
}
function validationError(error: unknown): never {
  if (error instanceof AttachmentValidationError) throw new ApiError(422, error.message);
  throw error;
}
function pending(row: AttachmentRow) {
  if (!['reserved', 'uploaded', 'ready'].includes(row.status) || row.expiresAt <= new Date().toISOString()) throw new ApiError(409, 'Este adjunto venció o ya no pertenece al borrador. Vuelve a adjuntarlo.');
}
async function scopeAccess(access: AccessContext, scope: Scope, database:Database=db()) {
  if (scope.kind === 'contract') {
    requireAdmin(access);
    const feature=await database.prepare('SELECT \"featuresJson\" FROM \"evolutionFeatures\" WHERE \"ownerId\"=$1').bind(access.ownerId).first<{featuresJson:string}>();
    if(!parseEvolutionFeatures(feature?.featuresJson).serviceContext)throw new ApiError(503,'Los contratos están en pausa. El borrador se conserva.');
    const contract=await database.prepare('SELECT id FROM "serviceContracts" WHERE id=$1 AND "ownerId"=$2 AND NOT archived').bind(scope.contractId!,access.ownerId).first();
    if (!contract) throw new ApiError(404, 'El contrato no está disponible para adjuntar documentos.');
    return;
  }
  if (scope.kind === 'note' && access.role === 'client') throw new ApiError(403, 'Las notas internas están reservadas para el equipo.');
  if (scope.ticketId !== undefined) await getTicket(access, scope.ticketId);
}
async function liveAccess(tx: PoolClient, access: AccessContext): Promise<AccessContext> {
  await acquireTicketWorkLock(tx,access.ownerId);
  return lockAccess(tx,access);
}
async function transactionScope(tx: PoolClient, access: AccessContext, scope: Scope) {
  if (scope.kind === 'contract') {
    requireAdmin(access);
    const feature=(await tx.query('SELECT \"featuresJson\" FROM \"evolutionFeatures\" WHERE \"ownerId\"=$1',[access.ownerId])).rows[0];
    if(!parseEvolutionFeatures(feature?.featuresJson).serviceContext)throw new ApiError(503,'Los contratos están en pausa. El borrador se conserva.');
    const contract=(await tx.query('SELECT id FROM "serviceContracts" WHERE id=$1 AND "ownerId"=$2 AND NOT archived FOR SHARE',[scope.contractId,access.ownerId])).rows[0];
    if (!contract) throw new ApiError(404, 'El contrato no está disponible para adjuntar documentos.');
    return;
  }
  if (scope.kind === 'note' && access.role === 'client') throw new ApiError(403, 'Las notas internas están reservadas para el equipo.');
  if (scope.ticketId !== undefined) {
    const ticket = (await tx.query('SELECT * FROM tickets WHERE id=$1 AND "ownerId"=$2 FOR SHARE', [scope.ticketId, access.ownerId])).rows[0];
    if (!ticket || !canAccessTicket(access, ticket)) throw new ApiError(404, 'No tienes acceso a este ticket.');
  }
}

export async function listDraftAttachments(access: AccessContext, scope: Scope, database = db()) {
  await scopeAccess(access, scope, database);
  const rows = await database.prepare(`SELECT * FROM attachments WHERE "ownerId"=$1 AND "memberId"=$2 AND "draftId"=$3 AND kind=$4 AND "ticketId" IS NOT DISTINCT FROM $5 AND "contractId" IS NOT DISTINCT FROM $7::text AND status IN ('reserved','uploaded','ready') AND "expiresAt">$6 ORDER BY "createdAt",id`)
    .bind(access.ownerId, access.member.id, scope.draftId, scope.kind, scope.ticketId ?? null, new Date().toISOString(), scope.contractId ?? null).all<AttachmentRow>();
  return { attachments: rows.results.map(publicAttachment), configured: attachmentsConfigured() };
}

export async function reserveAttachment(access: AccessContext, input: z.infer<typeof reserveAttachmentSchema>, database: Database = db(), storage?: PrivateAttachmentStorage) {
  const store = storage ?? requireStorage();
  let file: ReturnType<typeof attachmentFileInfo>;
  try { file = attachmentFileInfo(input.name); } catch (error) { return validationError(error); }
  await scopeAccess(access, input, database);
  // A failed cleanup never prevents reading/sending an already ready attachment.
  await cleanupAttachments(access.ownerId, access.member.id, 10, database, store);
  const row = await database.transaction(async tx => {
    const fresh = await liveAccess(tx, access); // Serializes concurrent reservations per member.
    await transactionScope(tx, fresh, input);
    const rows = (await tx.query<AttachmentRow>(`SELECT * FROM attachments WHERE "ownerId"=$1 AND "memberId"=$2 AND status <> 'deleted' AND status <> 'attached'`, [access.ownerId, access.member.id])).rows;
    if (rows.length >= 10 || rows.reduce((sum, row) => sum + row.size, 0) + input.size > 100 * 1024 * 1024) throw new ApiError(409, 'Tienes 10 archivos o 100 MiB pendientes. Quita archivos o espera a que termine su limpieza.');
    if (rows.filter(row => row.draftId === input.draftId && row.kind === input.kind && !['deleting','deleted'].includes(row.status)).length >= 5) throw new ApiError(409, 'Puedes adjuntar hasta 5 archivos por mensaje.');
    const id = randomUUID(), now = new Date().toISOString(), expiresAt = new Date(Date.now() + 86400_000).toISOString();
    const pathname = `daybook/${attachmentStorageConfig()?.environment || 'qa'}/${access.organizationId==='daybook'?'':`workspaces/${createHash('sha256').update(access.ownerId).digest('hex')}/`}${randomUUID()}/${id}.bin`;
    return (await tx.query<AttachmentRow>(`INSERT INTO attachments (id,"ownerId","memberId","draftId","ticketId",kind,pathname,name,"contentType",size,status,"expiresAt","createdAt","updatedAt","contractId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'reserved',$11,$12,$12,$13) RETURNING *`, [id, access.ownerId, access.member.id, input.draftId, input.ticketId ?? null, input.kind, pathname, file.name, file.contentType, input.size, expiresAt, now, input.contractId ?? null])).rows[0];
  });
  return { attachment: publicAttachment(row), pathname: row.pathname, uploadUrl: workspaceApiPath('/api/attachments/upload',access.organizationId) };
}

export async function ownPendingAttachment(access: AccessContext, id: string, database = db()) {
  const row = await database.prepare('SELECT * FROM attachments WHERE id=$1 AND "ownerId"=$2 AND "memberId"=$3').bind(id, access.ownerId, access.member.id).first<AttachmentRow>();
  if (!row) throw new ApiError(404, 'El adjunto no existe o no tienes acceso.');
  pending(row);
  await scopeAccess(access, { draftId: row.draftId, kind: row.kind, ...(row.ticketId ? { ticketId: row.ticketId } : {}), ...(row.contractId ? { contractId: row.contractId } : {}) }, database);
  return row;
}

export async function attachmentUploadTokenOptions(access: AccessContext, id: string, pathname: string, multipart: boolean, database = db()) {
  // The member/row locks make removal and token issuance mutually exclusive.
  return database.transaction(async tx => {
    const fresh = await liveAccess(tx, access);
    const row = (await tx.query<AttachmentRow>('SELECT * FROM attachments WHERE id=$1 AND "ownerId"=$2 AND "memberId"=$3 FOR UPDATE', [id, access.ownerId, access.member.id])).rows[0];
    if (!row || row.pathname !== pathname) throw new ApiError(404, 'La reserva del archivo no existe.');
    pending(row);
    if (row.status === 'ready' || multipart) throw new ApiError(409, 'Esta carga no admite reemplazos ni fragmentos.');
    await transactionScope(tx, fresh, { draftId: row.draftId, kind: row.kind, ...(row.ticketId ? { ticketId: row.ticketId } : {}), ...(row.contractId ? { contractId: row.contractId } : {}) });
    return { allowedContentTypes: [row.contentType], maximumSizeInBytes: row.size, validUntil: Math.min(Date.parse(row.expiresAt), Date.now() + 5 * 60_000), addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 60 };
  });
}

export async function completeAttachment(access: AccessContext, id: string, database = db(), storage?: PrivateAttachmentStorage) {
  const row = await ownPendingAttachment(access, id, database);
  if (row.status === 'ready') return { attachment: publicAttachment(row) };
  const store = storage ?? requireStorage();
  let bytes: Buffer | null;
  try { bytes = await readAttachmentBytes(store, row.pathname, row.size); } catch (error) {
    if (error instanceof AttachmentSizeError) {
      await database.prepare(`UPDATE attachments SET status='deleting',"updatedAt"=$1 WHERE id=$2 AND status IN ('reserved','uploaded')`).bind(new Date().toISOString(), id).run();
      throw new ApiError(422, 'El tamaño del archivo no coincide con la reserva. Vuelve a adjuntarlo.');
    }
    throw new ApiError(503, 'No se pudo comprobar la carga. Intenta completar el archivo nuevamente.');
  }
  if (!bytes) throw new ApiError(409, 'La carga aún no está disponible. Intenta nuevamente.');
  await database.prepare(`UPDATE attachments SET status='uploaded',"uploadedAt"=COALESCE("uploadedAt",$1),"updatedAt"=$1 WHERE id=$2 AND status='reserved'`).bind(new Date().toISOString(), id).run();
  let validated: Awaited<ReturnType<typeof validateAttachment>>;
  try { validated = await validateAttachment(bytes, row.name, row.size); } catch (error) {
    await database.prepare(`UPDATE attachments SET status='deleting',"updatedAt"=$1 WHERE id=$2 AND status IN ('reserved','uploaded')`).bind(new Date().toISOString(), id).run();
    return validationError(error);
  }
  return database.transaction(async tx => {
    const fresh = await liveAccess(tx, access);
    const current = (await tx.query<AttachmentRow>('SELECT * FROM attachments WHERE id=$1 AND "ownerId"=$2 AND "memberId"=$3 FOR UPDATE', [id, access.ownerId, access.member.id])).rows[0];
    if (!current) throw new ApiError(404, 'El adjunto no existe.');
    pending(current);
    await transactionScope(tx, fresh, { draftId: row.draftId, kind: row.kind, ...(row.ticketId ? { ticketId: row.ticketId } : {}), ...(row.contractId ? { contractId: row.contractId } : {}) });
    const ready = (await tx.query<AttachmentRow>(`UPDATE attachments SET status='ready',"contentType"=$1,"validatedAt"=$2,"updatedAt"=$2 WHERE id=$3 RETURNING *`, [validated.contentType, new Date().toISOString(), id])).rows[0];
    return { attachment: publicAttachment(ready) };
  });
}

export async function removePendingAttachment(access: AccessContext, id: string, database = db()) {
  return database.transaction(async tx => {
    await liveAccess(tx, access);
    const row = (await tx.query<AttachmentRow>('SELECT * FROM attachments WHERE id=$1 AND "ownerId"=$2 AND "memberId"=$3 FOR UPDATE', [id, access.ownerId, access.member.id])).rows[0];
    if (!row) throw new ApiError(404, 'El adjunto no existe.');
    if (row.status === 'attached') throw new ApiError(409, 'Los adjuntos enviados se conservan con el historial.');
    if (!['deleting','deleted'].includes(row.status)) await tx.query(`UPDATE attachments SET status='deleting',"updatedAt"=$1 WHERE id=$2`, [new Date().toISOString(), id]);
    return { removed: true };
  });
}

/** Called only inside the ticket/message transaction; rollback also rolls back file links. */
export async function linkReadyAttachments(tx: PoolClient, access: AccessContext, input: { ids: string[]; draftId: string; kind: AttachmentKind; ticketId: number; messageId: number }) {
  if (!input.ids.length) return;
  if (input.ids.length > 5 || new Set(input.ids).size !== input.ids.length) throw new ApiError(400, 'Selecciona hasta 5 adjuntos diferentes.');
  const fresh = await liveAccess(tx, access);
  await transactionScope(tx, fresh, { draftId: input.draftId, kind: input.kind, ticketId: input.ticketId });
  const rows = (await tx.query<AttachmentRow>('SELECT * FROM attachments WHERE id=ANY($1::text[]) AND "ownerId"=$2 ORDER BY id FOR UPDATE', [input.ids, access.ownerId])).rows;
  if (rows.length !== input.ids.length) throw new ApiError(404, 'Uno de los adjuntos no existe o no tienes acceso.');
  const message = (await tx.query('SELECT kind FROM messages WHERE id=$1 AND "ticketId"=$2 AND "ownerId"=$3', [input.messageId, input.ticketId, access.ownerId])).rows[0];
  if (!message || message.kind !== input.kind) throw new ApiError(409, 'El adjunto no corresponde al mensaje.');
  for (const row of rows) {
    pending(row);
    if (row.status !== 'ready' || row.memberId !== access.member.id || row.draftId !== input.draftId || row.kind !== input.kind || row.messageId !== null || (input.kind === 'request' ? row.ticketId !== null : row.ticketId !== input.ticketId)) throw new ApiError(409, 'El adjunto no corresponde a este borrador o aún no está listo.');
  }
  await tx.query(`UPDATE attachments SET status='attached',"ticketId"=$1,"messageId"=$2,"updatedAt"=$3 WHERE id=ANY($4::text[])`, [input.ticketId, input.messageId, new Date().toISOString(), input.ids]);
}

export async function downloadAttachment(access: AccessContext, id: string, database = db(), storage?: PrivateAttachmentStorage) {
  const row = await database.prepare(`SELECT a.* FROM attachments a LEFT JOIN messages m ON m.id=a."messageId" AND m."ownerId"=a."ownerId" AND m."ticketId"=a."ticketId" AND m.kind=a.kind LEFT JOIN "serviceContracts" c ON c.id=a."contractId" AND c."ownerId"=a."ownerId"
    WHERE a.id=$1 AND a."ownerId"=$2 AND a.status='attached' AND ((a.kind='contract' AND c.id IS NOT NULL AND $6 IN ('owner','admin','agent')) OR (a.kind<>'contract' AND m.id IS NOT NULL)) AND EXISTS (SELECT 1 FROM members viewer
      WHERE viewer.id=$3 AND viewer."ownerId"=$2 AND viewer."organizationId"=$4 AND viewer."userId"=$5 AND viewer.status='active'
        AND viewer.role=$6 AND viewer."customerCompanyId" IS NOT DISTINCT FROM $7::text AND viewer."companyAccess"=$8)`)
    .bind(id, access.ownerId, access.member.id, access.organizationId, access.userId, access.role, access.member.customerCompanyId, access.member.companyAccess).first<AttachmentRow>();
  if (!row || (row.kind !== 'contract' && !row.ticketId) || (row.kind === 'note' && access.role === 'client')) throw new ApiError(404, 'El adjunto no existe o no tienes acceso.');
  if (row.kind === 'contract') requireStaff(access);
  else await getTicket(access, row.ticketId!);
  const store = storage ?? requireStorage();
  let file;
  try { file = await store.read(row.pathname); } catch { throw new ApiError(503, 'No se pudo descargar el archivo. Intenta nuevamente.'); }
  if (!file) throw new ApiError(404, 'El archivo no está disponible.');
  if (file.size !== row.size) { await file.stream.cancel(); throw new ApiError(503, 'No se pudo verificar el archivo.'); }
  const filename = encodeURIComponent(row.name).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(file.stream, { headers: {
    'Content-Type': row.contentType, 'Content-Length': String(row.size),
    'Content-Disposition': `attachment; filename="attachment"; filename*=UTF-8''${filename}`,
    'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'", 'Referrer-Policy': 'no-referrer',
  } });
}

/** Same account/ticket/note authorization as downloads; never publishes a Blob URL. */
export async function previewAttachment(access: AccessContext, id: string, database = db(), storage?: PrivateAttachmentStorage) {
  const response = await downloadAttachment(access, id, database, storage);
  if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(response.headers.get('Content-Type') || '')) {
    await response.body?.cancel();
    throw new ApiError(415, 'Este archivo se puede descargar, pero no tiene vista previa.');
  }
  const headers = new Headers(response.headers);
  headers.set('Content-Disposition', (headers.get('Content-Disposition') || 'attachment').replace(/^attachment/, 'inline'));
  headers.set('Content-Security-Policy', "sandbox; default-src 'none'; frame-ancestors 'self'");
  return new Response(response.body, { headers });
}

/** Bounded, retryable cleanup. Sent files are never eligible. No cron or store-wide listing. */
export async function cleanupAttachments(ownerId: string, memberId: string | null, limit = 10, database = db(), storage?: PrivateAttachmentStorage) {
  if (!storage && !attachmentsConfigured()) return { deleted: 0 };
  const store = storage ?? requireStorage();
  const now = new Date().toISOString(), settled = new Date(Date.now() - 6 * 60_000).toISOString();
  const candidates = await database.transaction(async tx => {
    const rows = (await tx.query<AttachmentRow>(`SELECT * FROM attachments WHERE "ownerId"=$1 AND ($2::text IS NULL OR "memberId"=$2) AND ((status IN ('reserved','uploaded','ready') AND "expiresAt"<$3) OR (status='deleting' AND "updatedAt"<$3)) ORDER BY "expiresAt",id LIMIT $4 FOR UPDATE SKIP LOCKED`, [ownerId, memberId, settled, Math.min(20, Math.max(1, limit))])).rows;
    // Hold a short lease before storage I/O so concurrent cleaners cannot claim the same rows.
    if (rows.length) await tx.query(`UPDATE attachments SET status='deleting',"updatedAt"=$1 WHERE id=ANY($2::text[])`, [now, rows.map(row => row.id)]);
    return rows;
  });
  let deleted = 0;
  const deadline = Date.now() + 10_000;
  for (const row of candidates) {
    if (Date.now() >= deadline) break;
    try {
      await store.remove(row.pathname);
      await database.prepare(`UPDATE attachments SET status='deleted',"updatedAt"=$1 WHERE id=$2 AND status='deleting' AND "updatedAt"=$3`).bind(new Date().toISOString(), row.id, now).run();
      deleted++;
    } catch { /* Retry the leased row on later activity; never expose storage errors or keys. */ }
  }
  return { deleted };
}


/** Contract files have an explicit private destination, never a synthetic message. */
export async function linkContractAttachments(tx: PoolClient, access: AccessContext, input: { ids: string[]; draftId: string; contractId: string }) {
  const fresh = requireAdmin(await liveAccess(tx, access));
  await transactionScope(tx, fresh, {draftId:input.draftId, kind:'contract', contractId:input.contractId});
  if (!input.ids.length || input.ids.length>5 || new Set(input.ids).size!==input.ids.length) throw new ApiError(400,'Selecciona hasta cinco archivos diferentes.');
  const count=(await tx.query('SELECT COUNT(*)::integer AS total FROM attachments WHERE "contractId"=$1 AND "ownerId"=$2 AND status=\'attached\'',[input.contractId,access.ownerId])).rows[0].total;
  if(count+input.ids.length>100) throw new ApiError(409,'El contrato admite hasta 100 documentos.');
  const rows=(await tx.query<AttachmentRow>('SELECT * FROM attachments WHERE id=ANY($1::text[]) AND "ownerId"=$2 ORDER BY id FOR UPDATE',[input.ids,access.ownerId])).rows;
  if(rows.length!==input.ids.length) throw new ApiError(404,'Uno de los archivos no existe.');
  for(const row of rows) {
    pending(row);
    if(row.status!=='ready' || row.memberId!==access.member.id || row.draftId!==input.draftId || row.kind!=='contract' || row.contractId!==input.contractId || row.ticketId!==null || row.messageId!==null) throw new ApiError(409,'Un archivo no pertenece a este borrador del contrato o aún no está listo.');
  }
  await tx.query('UPDATE attachments SET status=\'attached\',"updatedAt"=$1 WHERE id=ANY($2::text[])',[new Date().toISOString(),input.ids]);
}
