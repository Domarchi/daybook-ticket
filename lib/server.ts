import { getDatabase } from '../db';
import type { Database } from '../db/database';
import { z } from 'zod';
import { getDaybookUser } from './daybook-auth';
import { DEFAULT_SETTINGS, type Settings, type Ticket, type Message, type Article } from './types';
import type { AccessContext } from './access';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const shortText = z.string().trim().min(1, 'Completa los campos obligatorios.').max(160, 'El texto es demasiado largo.');
export const messageBody = z.string().trim().min(1, 'Escribe un mensaje.').max(20000, 'El mensaje no puede superar 20.000 caracteres.');
export const ticketStatus = z.enum(['open', 'pending', 'resolved']);
export const ticketPriority = z.enum(['low', 'normal', 'high', 'urgent']);
export const emailAddress = z.string().trim().email('Introduce un correo válido.').max(254).transform(v => v.toLowerCase());
const memberId = z.union([z.string().uuid('Selecciona una cuenta válida.'), z.literal('')]).nullable().transform(v => v || null);
export const createTicketSchema = z.object({
  subject: shortText,
  requesterName: shortText.optional(),
  requesterEmail: emailAddress.optional(),
  requesterMemberId: memberId.optional(),
  department: shortText,
  assignee: z.string().trim().max(160).default(''),
  assigneeMemberId: memberId.optional(),
  priority: ticketPriority.default('normal'),
  body: messageBody,
}).strict();
export const patchTicketSchema = z.object({
  subject: shortText.optional(),
  department: shortText.optional(),
  assignee: z.string().trim().max(160).optional(),
  assigneeMemberId: memberId.optional(),
  requesterMemberId: memberId.optional(),
  priority: ticketPriority.optional(),
  status: ticketStatus.optional(),
}).strict().refine(v => Object.keys(v).length > 0, 'No hay cambios para guardar.');
export const messageSchema = z.object({ body: messageBody, kind: z.enum(['reply', 'note']) }).strict();
export const inviteMemberSchema = z.object({ name: shortText, email: emailAddress, role: z.enum(['admin', 'agent', 'client']) }).strict();
export const patchMemberSchema = z.object({
  role: z.enum(['admin', 'agent', 'client']).optional(),
  status: z.enum(['invited', 'active', 'revoked']).optional(),
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
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ error: error.issues[0]?.message || 'Revisa los datos enviados.' }, 400);
    console.error('Daybook Ticket API failure', error instanceof Error ? error.message : 'Unknown error');
    return json({ error: 'No se pudieron guardar o consultar los datos. Intenta nuevamente.' }, 500);
  }
}
export async function getSettings(ownerId: string): Promise<Settings> {
  const row = await db().prepare("SELECT data FROM settings WHERE \"ownerId\" = $1").bind(ownerId).first<{ data: string }>();
  if (!row) return structuredClone(DEFAULT_SETTINGS);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...JSON.parse(row.data) };
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
  const scope = access.role === 'client' ? ' AND "requesterMemberId" = $3' : '';
  const values = access.role === 'client' ? [id, access.ownerId, access.member.id] : [id, access.ownerId];
  const ticket = await db().prepare(`SELECT ${ticketColumns} FROM tickets WHERE id = $1 AND "ownerId" = $2${scope}`).bind(...values).first<Ticket>();
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
export const ticketColumns = 'id, subject, "requesterName", "requesterEmail", "requesterMemberId", department, assignee, "assigneeMemberId", status, priority, "createdAt", "updatedAt", "dueAt"';
export const messageColumns = 'id, "ticketId", author, body, kind, "createdAt"';
export const articleColumns = 'id, title, category, body, published, "createdAt", "updatedAt"';
export const asArticle = (row: Article) => ({ ...row, published: Boolean(row.published) });
export type RouteContext = { params: Promise<{ id: string }> };
