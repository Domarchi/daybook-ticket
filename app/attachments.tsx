'use client';
import { useId } from 'react';
import { Download, FileText, Paperclip, X } from 'lucide-react';
import { ATTACHMENT_ACCEPT, attachmentSize } from '@/lib/attachment-drafts';
import type { DraftAttachmentControls } from '@/hooks/use-draft-attachments';
export function AttachmentComposer({ controls, disabled = false }: { controls: DraftAttachmentControls; disabled?: boolean }) {
  const id = useId();
  return <div className="attachment-composer">
    <div className="attachment-toolbar"><label htmlFor={id} className={`secondary attachment-picker ${disabled || controls.busy || !controls.configured ? 'is-disabled' : ''}`}><Paperclip size={15}/>Adjuntar archivos<input id={id} type="file" multiple accept={ATTACHMENT_ACCEPT} disabled={disabled || controls.busy || controls.loading || !controls.configured || controls.attachments.length >= 5} onChange={event => { const files = event.target.files; if (files?.length) void controls.add(files); event.target.value = ''; }}/></label><small>Hasta 5 archivos de 10 MB. Imágenes, PDF, texto u Office.</small></div>
    {controls.loading && <p role="status">Recuperando adjuntos…</p>}
    {!controls.loading && !controls.configured && !controls.error && <p>Los adjuntos todavía no están disponibles. Puedes enviar tu mensaje de texto.</p>}
    {controls.error && <div className="attachment-error" role="alert"><span>{controls.error}</span><button className="text-button" type="button" disabled={disabled || controls.busy} onClick={controls.retryLoad}>Revisar adjuntos</button></div>}
    {controls.attachments.length > 0 && <ul className="attachment-list">{controls.attachments.map(item => <li key={item.id}><FileText size={17}/><div><strong>{item.name}</strong><small>{attachmentSize(item.size)} · {item.confirmationPending ? 'Envío pendiente de confirmar' : item.status === 'ready' ? 'Listo para enviar' : controls.busy ? `${item.progress || 0}% · Preparando archivo` : 'Carga pendiente de completar'}</small>{controls.busy && item.status !== 'ready' && <progress max={100} value={item.progress || 0} aria-label={`Progreso de ${item.name}`}/>}</div>{item.status !== 'ready' && !controls.busy && <button className="text-button" type="button" disabled={disabled} onClick={() => controls.retryComplete(item.id)}>Completar</button>}<button className="icon-button" type="button" disabled={disabled || controls.busy} aria-label={`Quitar ${item.name}`} onClick={() => controls.remove(item.id)}><X size={16}/></button></li>)}</ul>}
  </div>;
}
export function MessageAttachments({ attachments }: { attachments?: { id: string; name: string; size: number }[] }) {
  if (!attachments?.length) return null;
  return <ul className="message-attachments">{attachments.map(item => <li key={item.id}><a href={`/api/attachments/${item.id}/download`} download><Download size={15}/><span>{item.name}<small>{attachmentSize(item.size)}</small></span></a></li>)}</ul>;
}
