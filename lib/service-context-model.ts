import { z } from 'zod';

const text = (max = 180) => z.string().trim().max(max);
const id = z.string().uuid();
export const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const date = new Date(`${value}T12:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; }, 'La fecha no es válida.');
const nullableId = id.nullable().default(null);
const nullableDate = calendarDate.nullable().default(null);
export const SERVICE_RESOURCES = ['profiles', 'sites', 'assets', 'services', 'contracts'] as const;
export type ServiceResource = typeof SERVICE_RESOURCES[number];
const common = { companyId: id, notes: text(5000).default(''), archived: z.boolean().default(false) };
export const profileSchema = z.object({ companyId: id, legalName: text().default(''), taxId: text(50).default(''), industry: text(120).default(''), website: text(500).refine(value => !value || /^https:\/\//i.test(value) && (() => { try { const url = new URL(value); return !url.username && !url.password; } catch { return false; } })(), 'Usa un sitio HTTPS sin credenciales.').default(''), primaryContactMemberId: nullableId, notes: text(5000).default('') }).strict();
export const siteSchema = z.object({ ...common, name: text().min(1), address: text(500).default(''), primaryContactMemberId: nullableId }).strict();
export const assetSchema = z.object({ ...common, name: text().min(1), category: text(100).default('Equipo'), vendor: text(100).default(''), model: text(120).default(''), serial: text(120).default(''), siteId: nullableId, assignedContactMemberId: nullableId, responsibleMemberId: nullableId, warrantyUntil: nullableDate }).strict();
export const serviceSchema = z.object({ ...common, name: text().min(1), description: text(5000).default(''), responsibleMemberId: nullableId }).strict();
export const contractSchema = z.object({ ...common, name: text().min(1), reference: text(120).default(''), provider: text(180).default(''), startsOn: calendarDate, endsOn: calendarDate, renewalOn: nullableDate, responsibleMemberId: nullableId, serviceIds: z.array(id).max(50).default([]) }).strict().refine(value => value.endsOn >= value.startsOn, 'La fecha final debe ser posterior al inicio.').refine(value => value.renewalOn === null || value.renewalOn >= value.startsOn, 'La renovación debe ser posterior al inicio.').refine(value => new Set(value.serviceIds).size === value.serviceIds.length, 'No repitas servicios.');
export const serviceSchemas = { profiles: profileSchema, sites: siteSchema, assets: assetSchema, services: serviceSchema, contracts: contractSchema };
export type CompanyProfile = z.infer<typeof profileSchema> & { id: string; version: number; createdAt: string; updatedAt: string };
export type CompanySite = z.infer<typeof siteSchema> & { id: string; version: number; createdAt: string; updatedAt: string };
export type CustomerAsset = z.infer<typeof assetSchema> & { id: string; version: number; createdAt: string; updatedAt: string; reminderBaselineAt: string };
export type CustomerService = z.infer<typeof serviceSchema> & { id: string; version: number; createdAt: string; updatedAt: string };
export type ServiceContract = z.infer<typeof contractSchema> & { id: string; version: number; createdAt: string; updatedAt: string; reminderBaselineAt: string };
export type ServiceEntity = CompanyProfile | CompanySite | CustomerAsset | CustomerService | ServiceContract;
export interface ServicePage<T = ServiceEntity> { items: T[]; nextCursor: string | null }
export interface ServiceReminder { id: string; entityKind: 'asset' | 'contract'; entityId: string; companyId: string; entityName: string; dateValue: string; stage: 30 | 7 | 0; readAt: string | null; createdAt: string }
export interface ServiceReminderConfig { enabled: boolean; activatedAt: string | null; version: number; updatedAt: string | null }
export const ticketContextSchema = z.object({ expectedVersion: z.number().int().min(0), assetIds: z.array(id).max(20), contractIds: z.array(id).max(20) }).strict().refine(value => new Set(value.assetIds).size === value.assetIds.length && new Set(value.contractIds).size === value.contractIds.length, 'No repitas equipos ni contratos.');
export interface TicketServiceContext { version: number; assetIds: string[]; contractIds: string[]; assets: CustomerAsset[]; contracts: ServiceContract[] }
export const contractDocumentsSchema = z.object({ operationId: id, draftId: id, attachmentIds: z.array(id).min(1).max(5) }).strict().refine(value => new Set(value.attachmentIds).size === value.attachmentIds.length, 'No repitas archivos.');
export function santiagoDate(now: Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
export function serviceDueStage(dateValue: string, baselineAt: string, activatedAt: string, now: Date): 30 | 7 | 0 | null {
  if (!calendarDate.safeParse(dateValue).success || !Number.isFinite(Date.parse(baselineAt)) || !Number.isFinite(Date.parse(activatedAt)) || !Number.isFinite(now.getTime())) return null;
  const today = santiagoDate(now), due = Date.parse(`${dateValue}T12:00:00Z`), days = Math.round((due - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  const stage = days <= 0 ? 0 : days <= 7 ? 7 : days <= 30 ? 30 : null;
  if (stage === null) return null;
  const entered = new Date(due - stage * 86400000).toISOString().slice(0, 10);
  // Existing or imported dates do not synthesize stages that preceded activation/edit.
  return santiagoDate(new Date(Math.max(Date.parse(baselineAt), Date.parse(activatedAt)))) < entered ? stage : null;
}
