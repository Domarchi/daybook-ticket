'use client';
import { workspaceApiPath } from '@/lib/workspace-model';
import { currentWorkspaceId } from '@/lib/workspace-client';
import { daybookFetch } from '@/lib/browser-request';

import { useEffect, useId, useRef, useState } from 'react';
import { Download, Eye, FileText, Paperclip, X } from 'lucide-react';
import { ATTACHMENT_ACCEPT, attachmentSize } from '@/lib/attachment-drafts';
import type { DraftAttachmentControls } from '@/hooks/use-draft-attachments';
export function AttachmentComposer({
  controls,
  disabled = false,
}: {
  controls: DraftAttachmentControls;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="attachment-composer">
      <div className="attachment-toolbar">
        <label
          htmlFor={id}
          className={`secondary attachment-picker ${disabled || controls.busy || !controls.configured ? 'is-disabled' : ''}`}
        >
          <Paperclip size={15} />
          Adjuntar archivos
          <input
            id={id}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            disabled={
              disabled || controls.busy || controls.loading || !controls.configured || controls.attachments.length >= 5
            }
            onChange={event => {
              const files = event.target.files;
              if (files?.length) void controls.add(files);
              event.target.value = '';
            }}
          />
        </label>
        <small>Hasta 5 archivos de 10 MB. Imágenes, PDF, texto u Office.</small>
      </div>
      {controls.loading && <p role="status">Recuperando adjuntos…</p>}
      {!controls.loading && !controls.configured && !controls.error && (
        <p>Los adjuntos todavía no están disponibles. Puedes enviar tu mensaje de texto.</p>
      )}
      {controls.error && (
        <div className="attachment-error" role="alert">
          <span>{controls.error}</span>
          <button
            className="text-button"
            type="button"
            disabled={disabled || controls.busy}
            onClick={controls.retryLoad}
          >
            Revisar adjuntos
          </button>
        </div>
      )}
      {controls.attachments.length > 0 && (
        <ul className="attachment-list">
          {controls.attachments.map(item => (
            <li key={item.id}>
              <FileText size={17} />
              <div>
                <strong>{item.name}</strong>
                <small>
                  {attachmentSize(item.size)} ·{' '}
                  {item.confirmationPending
                    ? 'Envío pendiente de confirmar'
                    : item.status === 'ready'
                      ? 'Listo para enviar'
                      : controls.busy
                        ? `${item.progress || 0}% · Preparando archivo`
                        : 'Carga pendiente de completar'}
                </small>
                {controls.busy && item.status !== 'ready' && (
                  <progress max={100} value={item.progress || 0} aria-label={`Progreso de ${item.name}`} />
                )}
              </div>
              {item.status !== 'ready' && !controls.busy && (
                <button
                  className="text-button"
                  type="button"
                  disabled={disabled}
                  onClick={() => controls.retryComplete(item.id)}
                >
                  Completar
                </button>
              )}
              <button
                className="icon-button"
                type="button"
                disabled={disabled || controls.busy}
                aria-label={`Quitar ${item.name}`}
                onClick={() => controls.remove(item.id)}
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
type PreviewFile = { id: string; name: string; size: number; contentType?: string };
export function MessageAttachments({ attachments }: { attachments?: PreviewFile[] }) {
  const [selected, setSelected] = useState<PreviewFile | null>(null);
  if (!attachments?.length) return null;
  return (
    <>
      <ul className="message-attachments">
        {attachments.map(item => (
          <li key={item.id}>
            <a href={workspaceApiPath(`/api/attachments/${item.id}/download`, currentWorkspaceId())} download>
              <Download size={15} />
              <span>
                {item.name}
                <small>{attachmentSize(item.size)}</small>
              </span>
            </a>
            {['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(item.contentType || '') && (
              <button
                type="button"
                className="attachment-preview-button"
                onClick={() => setSelected(item)}
                aria-label={`Ver ${item.name}`}
              >
                <Eye size={15} />
                Vista previa
              </button>
            )}
          </li>
        ))}
      </ul>
      {selected && <AttachmentPreview key={selected.id} attachment={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function AttachmentPreview({ attachment, onClose }: { attachment: PreviewFile; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null),
    title = useId();
  const [file, setFile] = useState<{ url: string; type: string; nativePdfViewer: boolean } | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void (async () => {
      try {
        const response = await daybookFetch(`/api/attachments/${attachment.id}/preview`, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('No se pudo abrir el archivo. Comprueba tu acceso o vuelve a intentarlo.');
        const type = response.headers.get('Content-Type') || '';
        if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(type))
          throw new Error('Este formato no tiene vista previa.');
        const blob = await response.blob();
        if (blob.size !== attachment.size || blob.size > 10 * 1024 * 1024)
          throw new Error('No se pudo verificar el tamaño del archivo.');
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        // Capability detection happens in the browser effect after loading, never during SSR/hydration.
        setFile({ url: objectUrl, type, nativePdfViewer: navigator.pdfViewerEnabled !== false });
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'No se pudo abrir el archivo.');
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id, attachment.size, attempt]);
  return (
    <dialog
      ref={dialog}
      className="attachment-preview-dialog"
      aria-labelledby={title}
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="attachment-preview-header">
        <strong id={title}>{attachment.name}</strong>
        <button type="button" className="icon-button" aria-label="Cerrar vista previa" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <div className="attachment-preview-body">
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setError('');
                setFile(null);
                setAttempt(attempt + 1);
              }}
            >
              Volver a intentar
            </button>
          </div>
        ) : !file ? (
          <p role="status">Abriendo archivo protegido…</p>
        ) : file.type === 'application/pdf' ? (
          <PdfAttachmentPreview attachment={attachment} fileUrl={file.url} nativePdfViewer={file.nativePdfViewer} />
        ) : (
          // Blob bytes came from the authenticated preview route, not an external image URL.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={file.url}
            alt={attachment.name}
            onError={() => setError('No se pudo mostrar esta imagen. Puedes descargar el archivo.')}
          />
        )}
      </div>
      <footer>
        <a
          className="secondary"
          href={workspaceApiPath(`/api/attachments/${attachment.id}/download`, currentWorkspaceId())}
          download
        >
          <Download size={15} />
          Descargar
        </a>
        <button type="button" className="primary" onClick={onClose}>
          Cerrar
        </button>
      </footer>
    </dialog>
  );
}

/** Only a validated application/pdf Blob from the authorized private route reaches this viewer.
 * Native PDF plugins are blocked by iframe sandbox; the browser isolates its own PDF viewer.
 * A protected download remains visible when inline PDF rendering is unavailable. */
export function PdfAttachmentPreview({
  attachment,
  fileUrl,
  nativePdfViewer,
}: {
  attachment: PreviewFile;
  fileUrl: string;
  nativePdfViewer: boolean;
}) {
  const downloadUrl = workspaceApiPath(`/api/attachments/${attachment.id}/download`, currentWorkspaceId());
  return (
    <div className={`attachment-pdf-preview ${nativePdfViewer ? 'has-native-viewer' : 'download-only'}`}>
      {nativePdfViewer ? (
        <iframe
          src={fileUrl}
          title={`Vista previa de ${attachment.name}`}
          referrerPolicy="no-referrer"
          allow="camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'"
        />
      ) : (
        <div className="attachment-pdf-unavailable">
          <FileText size={34} aria-hidden="true" />
          <strong>Descarga el PDF para verlo</strong>
          <p>Este navegador no permite mostrar el documento aquí. Puedes abrirlo en el visor de PDF de tu equipo.</p>
        </div>
      )}
      <p className="attachment-pdf-help">
        {nativePdfViewer ? 'Si el documento no se muestra, puedes descargarlo para abrirlo en tu visor. ' : ''}
        <a href={downloadUrl} download>
          <Download size={15} aria-hidden="true" />
          Descargar PDF
        </a>
      </p>
    </div>
  );
}
