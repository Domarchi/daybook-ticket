import { getDatabase } from '../db';
import type { Database } from '../db/database';
import { z } from 'zod';
import { getDaybookUser } from './daybook-auth';
import { DEFAULT_SETTINGS, type Settings, type Ticket, type Article } from './types';
import { ticketAccessSql, type AccessContext } from './access';

export class ApiError extends Error {
  constructor(public status: number, message: string, public redirectTo?: string) { super(message); }
}
export const shortText = z.string().trim().min(1, 'Completa los campos obligatorios.').max(160, 'El texto es demasiado largo.');
export const messageBody = z.string().trim().min(1, 'Escribe un mensaje.').max(20000, 'El mensaje no puede superar 20.000 caracteres.');
export const ticketStatus = z.enum(['open', 'pending', 'resolved']);
export const ticketPriority = z.enum(['low', 'normal', 'high', 'urgent']);
export const emailAddress = z.string().trim().email('Introduce un correo válido.').max(254).transform(v => v.toLowerCase());
const memberId = z.union([z.string().uuid('Selecciona una cuenta válida.'), z.literal('')]).nullable().transform(v => v || null);
export const createTicketSchema = z.object({
  operationId: z.string().uuid(),
  draftId: z.string().uuid().optional(),
  attachmentIds: z.array(z.string().uuid()).max(5).default([]),
  subject: shortText,
  requesterName: shortText.optional(),
  requesterEmail: emailAddress.optional(),
  requesterMemberId: memberId.optional(),
  department: shortText,
  assignee: z.string().trim().max(160).default(''),
  assigneeMemberId: memberId.optional(),
  priority: ticketPriority.default('normal'),
  body: messageBody,
  bodyFormat: z.enum(['plain', 'markdown']).optional(),
}).strict();
export const patchTicketSchema = z.object({
  isTest: z.boolean().optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  customerCompanyId: memberId.optional(),
  subject: shortText.optional(),
  department: shortText.optional(),
  assignee: z.string().trim().max(160).optional(),
  assigneeMemberId: memberId.optional(),
  requesterMemberId: memberId.optional(),
  priority: ticketPriority.optional(),
  status: ticketStatus.optional(),
}).strict().refine(v => Object.keys(v).length > 0, 'No hay cambios para guardar.');
export const messageSchema = z.object({ operationId: z.string().uuid(), draftId: z.string().uuid().optional(), attachmentIds: z.array(z.string().uuid()).max(5).default([]), body: messageBody, bodyFormat: z.enum(['plain', 'markdown']).optional(), kind: z.enum(['reply', 'note']) }).strict();
export const inviteMemberSchema = z.object({
  isTest: z.boolean().optional(),
  name: shortText, email: emailAddress, role: z.enum(['admin', 'agent', 'client']),
  customerCompanyId: memberId.optional(), companyAccess: z.enum(['own', 'manager']).optional(),
}).strict();
export const patchMemberSchema = z.object({
  isTest: z.boolean().optional(),
  role: z.enum(['admin', 'agent', 'client']).optional(),
  status: z.enum(['invited', 'active', 'revoked']).optional(),
  customerCompanyId: memberId.optional(),
  companyAccess: z.enum(['own', 'manager']).optional(),
}).strict().refine(v => Object.keys(v).length > 0, 'No hay cambios para guardar.');
export const articleSchema = z.object({
  title: shortText,
  category: shortText,
  body: messageBody,
  published: z.boolean().default(false),
}).strict();
// Zod 4 applies defaults inside optional fields; a PATCH must preserve omitted values.
export const patchArticleSchema = articleSchema.partial().extend({ published: z.boolean().optional() }).refine(v => Object.keys(v).length > 0, 'No hay cambios para guardar.');
const names = z.array(shortText).min(1, 'Agrega al menos una opción.').max(50).refine(v => new Set(v.map(n => n.toLowerCase())).size === v.length, 'Hay nombres duplicados.');
const hours = z.number().finite().min(1).max(8760);
export const settingsSchema = z.object({
  brandName: shortText,
  tagline: z.string().trim().max(200),
  agents: names,
  notificationMemberIds: z.array(z.string().uuid('Selecciona una cuenta válida del equipo.')).max(20, 'Puedes elegir hasta 20 responsables.').transform(ids => [...new Set(ids)]),
  departments: names,
  slaHours: z.object({ urgent: hours, high: hours, normal: hours, low: hours }).strict(),
}).strict().partial().refine(v => Object.keys(v).length > 0, 'No hay cambios para guardar.');

export function db(): Database {
  if (!process.env.DATABASE_URL) throw new ApiError(503, 'El almacenamiento no está disponible. Intenta nuevamente en unos minutos.');
  return getDatabase();
}
export async function auth(request?: Request) {
  if (request && request.method !== 'GET') {
    const origin = request.headers.get('origin');
    const siteUrl = process.env.DAYBOOK_SITE_URL;
    if (!siteUrl) throw new ApiError(503, 'El acceso de Daybook Ticket aún no está configurado.');
    // Next.js may reconstruct request.url from an internal proxy address.
    // Only the configured public origin is trusted for browser mutations.
    if (origin && origin !== new URL(siteUrl).origin) throw new ApiError(403, 'La solicitud debe realizarse desde Daybook Ticket.');
  }
  const user = await getDaybookUser(request);
  if (!user) throw new ApiError(401, 'Inicia sesión para continuar.');
  return user;
}
export async function parseBody<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.output<T>> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ApiError(415, 'Envía los datos en formato JSON.');
  if (Number(request.headers.get('content-length') || 0) > 100000) throw new ApiError(413, 'La solicitud es demasiado grande.');
  const text = await request.text();
  if (text.length > 100000) throw new ApiError(413, 'La solicitud es demasiado grande.');
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new ApiError(400, 'Los datos enviados no son válidos.'); }
  return schema.parse(data);
}
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
export async function handle(fn: () => Promise<Response>) {
  try { return await fn(); }
  catch (error) {
    if (error instanceof ApiError) return json({ error: error.message, ...(error.redirectTo ? { redirectTo: error.redirectTo } : {}) }, error.status);
    if (error instanceof z.ZodError) return json({ error: error.issues[0]?.message || 'Revisa los datos enviados.' }, 400);
    console.error('Daybook Ticket API failure', error instanceof Error ? error.message : 'Unknown error');
    return json({ error: 'No se pudieron guardar o consultar los datos. Intenta nuevamente.' }, 500);
  }
}
export async function getSettings(ownerId: string): Promise<Settings> {
  const row = await db().prepare("SELECT data FROM settings WHERE \"ownerId\" = $1").bind(ownerId).first<{ data: string }>();
  if (!row) return structuredClone(DEFAULT_SETTINGS);
  const settings: Settings = { ...structuredClone(DEFAULT_SETTINGS), ...JSON.parse(row.data) };
  // Upgrade the former product names without overwriting a customized brand.
  if (['VEXOR', 'NexoDesk'].includes(settings.brandName)) {
    const updated: Settings = {
      ...settings,
      brandName: DEFAULT_SETTINGS.brandName,
      tagline: settings.tagline === 'Cada conversación, una solución.'
        ? DEFAULT_SETTINGS.tagline
        : settings.tagline,
    };
    // Compare the stored value so a concurrent configuration edit is preserved.
    const result = await db().prepare("UPDATE settings SET data = $1 WHERE \"ownerId\" = $2 AND data = $3")
      .bind(JSON.stringify(updated), ownerId, row.data).run();
    if (result.meta.changes === 0) return getSettings(ownerId);
    return updated;
  }
  return settings;
}
export async function getTicket(access: AccessContext, id: number): Promise<Ticket> {
  const scope = ticketAccessSql(access, 't', 2);
  const values = [id, ...scope.values];
  const bind = (value: string | null) => { values.push(value); return `$${values.length}`; };
  const member = bind(access.member.id), role = bind(access.role), company = bind(access.member.customerCompanyId ?? null), permission = bind(access.member.companyAccess), user = bind(access.userId), organization = bind(access.organizationId);
  const ticket = await db().prepare(`SELECT ${ticketColumns} FROM tickets t WHERE t.id = $1 AND ${scope.sql}
    AND EXISTS (SELECT 1 FROM members live WHERE live.id=${member} AND live."ownerId"=t."ownerId" AND live."organizationId"=${organization}
      AND live."userId"=${user} AND live.status='active' AND live.role=${role} AND live."customerCompanyId" IS NOT DISTINCT FROM ${company}::text AND live."companyAccess"=${permission})`)
    .bind(...values).first<Ticket>();
  if (!ticket) throw new ApiError(404, 'El ticket no existe o no tienes acceso.');
  return ticket;
}
export function parseId(raw: string) {
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) throw new ApiError(400, 'El identificador no es válido.');
  return Number(raw);
}
export function checkAssignment(data: { department?: string; assignee?: string }, settings: Settings) {
  if (data.department !== undefined && !settings.departments.includes(data.department)) throw new ApiError(400, 'Selecciona un departamento válido.');
}
export const ticketColumns = '"isTest", id, subject, "requesterName", "requesterEmail", "requesterMemberId", "customerCompanyId", version, department, assignee, "assigneeMemberId", status, priority, "createdAt", "updatedAt", "dueAt"';
export const messageColumns = 'id, "ticketId", author, "authorMemberId", "authorRole", body, "bodyFormat", kind, "createdAt", \'[]\'::jsonb AS attachments';
export const articleColumns = 'id, title, category, body, published, "createdAt", "updatedAt"';
export const asArticle = (row: Article) => ({ ...row, published: Boolean(row.published) });
export type RouteContext = { params: Promise<{ id: string }> };
