'use client';
import { useEffect, useRef, useState } from 'react';
import { upload } from '@vercel/blob/client';
import { attachmentDraftId, attachmentValidation, restorePendingAttachmentIds } from '@/lib/attachment-drafts';
import { clientRequest } from '@/lib/client-request';
import { getDraftOperations } from '@/lib/draft-operations';
export type DraftAttachment = { id: string; name: string; size: number; contentType: string; status: string; expiresAt?: string; progress?: number; confirmationPending?: boolean };
type State = { scope: string; draftId: string; attachments: DraftAttachment[]; loading: boolean; configured: boolean; error: string; uploading: boolean; failedLoad: boolean };
const cachedAttachments = new Map<string, DraftAttachment[]>();
function rememberAttachments(draftId: string, attachments: DraftAttachment[]) {
  cachedAttachments.set(draftId, attachments);
  try { sessionStorage.setItem(`daybook.ticket.attachment-files.v1.${draftId}`, JSON.stringify(attachments)); } catch { /* Current-page retries still retain file metadata. */ }
}
function rememberedAttachments(draftId: string): DraftAttachment[] {
  const memory = cachedAttachments.get(draftId);
  if (memory) return memory;
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(`daybook.ticket.attachment-files.v1.${draftId}`) || '[]');
    if (Array.isArray(value)) return value.filter((item): item is DraftAttachment => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.size === 'number' && typeof item.contentType === 'string'));
  } catch { /* Optional recovery from session storage. */ }
  return [];
}
function restoreAttempt(scope: string, draftId: string, received: DraftAttachment[]) {
  const attempt = getDraftOperations().previous(scope)?.payload;
  // A lost POST response can leave consumed files absent from the pending-file API.
  return restorePendingAttachmentIds(draftId, received, rememberedAttachments(draftId), attempt);
}
function initial(scope: string): State { return { scope, draftId: attachmentDraftId(scope), attachments: [], loading: true, configured: false, error: '', uploading: false, failedLoad: false }; }
export function useDraftAttachments(scope: string, kind: 'request' | 'reply' | 'note', ticketId?: number) {
  const [state, setState] = useState(() => initial(scope));
  const [revision, setRevision] = useState(0);
  const operation = useRef(false);
  if (state.scope !== scope) setState(initial(scope));
  const current = state.scope === scope ? state : null;
  const draftId = current?.draftId;
  useEffect(() => {
    if (!draftId) return;
    let active = true;
    const query = new URLSearchParams({ draftId, kind });
    if (ticketId) query.set('ticketId', String(ticketId));
    void clientRequest<{ attachments: DraftAttachment[]; configured: boolean }>(`/api/attachments?${query}`).then(result => { if (active) setState(previous => previous.draftId === draftId ? { ...previous, attachments: restoreAttempt(scope, draftId, result.attachments), configured: result.configured, error: '', failedLoad: false, loading: false } : previous); }).catch(error => { if (active) setState(previous => previous.draftId === draftId ? { ...previous, loading: false, failedLoad: true, error: error instanceof Error ? error.message : 'No se pudieron recuperar los adjuntos.' } : previous); });
    return () => { active = false; };
  }, [draftId, kind, ticketId, revision, scope]);
  useEffect(() => { if (!state.loading) rememberAttachments(state.draftId, state.attachments); }, [state.draftId, state.attachments, state.loading]);
  const update = (fn: (value: State) => State) => setState(previous => previous.scope === scope && previous.draftId === draftId ? fn(previous) : previous);
  const add = async (files: FileList | File[]) => {
    if (!current || operation.current || current.loading || !current.configured) return;
    operation.current = true;
    update(value => ({ ...value, error: '', uploading: true }));
    let count = current.attachments.length;
    try {
      for (const file of Array.from(files)) {
        const problem = attachmentValidation(file, count);
        if (problem) throw new Error(`${file.name}: ${problem}`);
        const reservation = await clientRequest<{ attachment: DraftAttachment; pathname: string; uploadUrl: string }>('/api/attachments/reserve', 'POST', { draftId, kind, ...(ticketId ? { ticketId } : {}), name: file.name, size: file.size, contentType: file.type || 'application/octet-stream' });
        count++;
        const attachment = reservation.attachment;
        update(value => ({ ...value, attachments: [...value.attachments, { ...attachment, progress: 0 }] }));
        await upload(reservation.pathname, file, { access: 'private', contentType: attachment.contentType, handleUploadUrl: reservation.uploadUrl, clientPayload: JSON.stringify({ attachmentId: attachment.id }), abortSignal: AbortSignal.timeout(60_000), onUploadProgress: progress => update(value => ({ ...value, attachments: value.attachments.map(item => item.id === attachment.id ? { ...item, progress: Math.round(progress.percentage) } : item) })) });
        update(value => ({ ...value, attachments: value.attachments.map(item => item.id === attachment.id ? { ...item, status: 'uploaded', progress: 100 } : item) }));
        const result = await clientRequest<{ attachment: DraftAttachment }>(`/api/attachments/${attachment.id}/complete`, 'POST', {});
        update(value => ({ ...value, attachments: value.attachments.map(item => item.id === attachment.id ? result.attachment : item) }));
      }
    } catch (error) { update(value => ({ ...value, error: error instanceof Error ? error.message : 'No se pudo adjuntar el archivo. Revisa su estado antes de enviar.' })); }
    finally { operation.current = false; update(value => ({ ...value, uploading: false })); }
  };
  const remove = async (id: string) => {
    if (operation.current) return;
    operation.current = true; update(value => ({ ...value, uploading: true, error: '' }));
    try { await clientRequest(`/api/attachments/${id}`, 'DELETE'); update(value => ({ ...value, attachments: value.attachments.filter(item => item.id !== id) })); }
    catch (error) { update(value => ({ ...value, error: error instanceof Error ? error.message : 'No se pudo quitar el archivo.' })); }
    finally { operation.current = false; update(value => ({ ...value, uploading: false })); }
  };
  const retryComplete = async (id: string) => {
    if (operation.current) return;
    operation.current = true; update(value => ({ ...value, uploading: true, error: '' }));
    try { const result = await clientRequest<{ attachment: DraftAttachment }>(`/api/attachments/${id}/complete`, 'POST', {}); update(value => ({ ...value, attachments: value.attachments.map(item => item.id === id ? result.attachment : item) })); }
    catch (error) { update(value => ({ ...value, error: error instanceof Error ? error.message : 'La carga no se completó. Quita el archivo y vuelve a adjuntarlo.' })); }
    finally { operation.current = false; update(value => ({ ...value, uploading: false })); }
  };
  return {
    attachments: current?.attachments || [], draftId: current?.draftId || '',
    loading: !current || current.loading, configured: current?.configured || false,
    busy: current?.uploading || false, error: current?.error || '',
    canSubmit: Boolean(current && !current.loading && !current.failedLoad && !current.uploading && current.attachments.every(item => item.status === 'ready')),
    add, remove, retryComplete,
    payload: () => { if (current) rememberAttachments(current.draftId, current.attachments); return { draftId: current?.draftId || '', attachmentIds: (current?.attachments || []).map(item => item.id).sort() }; },
    retryLoad: () => { update(value => ({ ...value, loading: true })); setRevision(value => value + 1); },
    complete: () => { if (draftId) rememberAttachments(draftId, []); const next = attachmentDraftId(scope, true); setState(previous => previous.scope === scope ? { ...initial(scope), draftId: next } : previous); },
  };
}
export type DraftAttachmentControls = ReturnType<typeof useDraftAttachments>;
