import { workspaceStorageKey } from './workspace-client';
export const ATTACHMENT_ACCEPT = '.png,.jpg,.jpeg,.webp,.pdf,.txt,.csv,.docx,.xlsx';
export const ATTACHMENT_LIMIT = 5;
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export function attachmentValidation(file: { name: string; size: number }, count: number): string | null {
  if (count >= ATTACHMENT_LIMIT) return 'Puedes adjuntar hasta 5 archivos por mensaje.';
  if (!/\.(png|jpe?g|webp|pdf|txt|csv|docx|xlsx)$/i.test(file.name)) return 'Usa archivos PNG, JPG, WEBP, PDF, TXT, CSV, DOCX o XLSX.';
  if (file.size <= 0) return 'El archivo está vacío.';
  if (file.size > ATTACHMENT_MAX_BYTES) return 'Cada archivo puede pesar hasta 10 MB.';
  return null;
}
const memory = new Map<string, string>();
export function attachmentDraftId(scope: string, renew = false) {
  const key = workspaceStorageKey(`daybook.ticket.attachments.v1.${scope}`);
  if (!renew) {
    const cached = memory.get(key);
    if (cached) return cached;
    try { const stored = sessionStorage.getItem(key); if (stored && /^[0-9a-f-]{36}$/i.test(stored)) { memory.set(key, stored); return stored; } } catch { /* Browser storage is optional. */ }
  }
  const id = crypto.randomUUID();
  memory.set(key, id);
  try { sessionStorage.setItem(key, id); } catch { /* Keep draft identity during navigation in this page. */ }
  return id;
}
export function attachmentSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function restorePendingAttachmentIds<T extends { id: string; status: string }>(draftId: string, received: T[], remembered: T[], attempt: unknown): (T & { confirmationPending?: boolean })[] {
  if (!attempt || typeof attempt !== 'object' || !('draftId' in attempt) || attempt.draftId !== draftId || !('attachmentIds' in attempt) || !Array.isArray(attempt.attachmentIds)) return received;
  const pending = new Set(attempt.attachmentIds);
  const receivedIds = new Set(received.map(item => item.id));
  return [...received, ...remembered.filter(item => pending.has(item.id) && !receivedIds.has(item.id)).map(item => ({ ...item, status: 'ready', confirmationPending: true }))];
}
