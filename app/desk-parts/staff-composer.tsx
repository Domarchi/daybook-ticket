'use client';
import { useDraftAttachments } from '@/hooks/use-draft-attachments';
import { useDraftQuote } from '@/hooks/use-draft-quote';
import { useTicketDraft } from '@/hooks/use-ticket-draft';
import { getDraftOperations } from '@/lib/draft-operations';
import { type DraftKind, ticketDraftKey } from '@/lib/ticket-drafts';
import { notifyTicketPresenceActivity } from '@/lib/ticket-presence-client';
import { LoaderCircle, MessageSquare, Send, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type Member, type Message, type Ticket } from '../../lib/types';
import { AttachmentComposer } from '../attachments';
import { MessageEditor } from '../message-content';
import { type SavedReplyItem, SavedReplyPicker } from '../saved-replies';
import { BitaDraft } from '../bita-draft';
import { PENDING_PLACEHOLDER, withDraft } from '@/lib/assistant-ui';

export function StaffComposer({
  ticket,
  viewer,
  savedReplies,
  legacyEmail,
  busy,
  onSave,
  replyTarget,
  onClearReply,
  collaboration,
  members,
  bitaDraft = false,
}: {
  ticket: Ticket;
  viewer: Member;
  legacyEmail: string;
  replyTarget: Message | null;
  onClearReply: () => void;
  collaboration: boolean;
  members: Member[];
  /** Bita can write a draft of the reply (feature 3): only when the server offers Bita to this person. */
  bitaDraft?: boolean;
  savedReplies: SavedReplyItem[];
  busy: boolean;
  onSave: (message: {
    body: string;
    bodyFormat?: 'plain' | 'markdown';
    kind: DraftKind;
    replyToMessageId?: number | null;
    mentionMemberIds?: string[];
    draftId: string;
    attachmentIds: string[];
    operationId: string;
  }) => Promise<boolean>;
}) {
  const { draft, message, persistent, selectKind, edit, complete, setReferences } = useTicketDraft(
    { memberId: viewer.id, role: viewer.role, ticketId: ticket.id },
    legacyEmail,
  );
  const scope = `${ticketDraftKey({ memberId: viewer.id, role: viewer.role, ticketId: ticket.id })}.${message.kind}`;
  const attachments = useDraftAttachments(scope, message.kind, ticket.id);
  const saving = useRef(false);
  // The draft arrives seconds after the click: it is added to what the composer holds then, not when it was asked.
  const latestBody = useRef(message.body);
  useEffect(() => {
    latestBody.current = message.body;
  }, [message.body]);
  const [pendingWarning, setPendingWarning] = useState(false);
  const mentionIds = message.mentionMemberIds ?? [];
  const setMentionIds = (ids: string[]) =>
    setReferences(message.kind, {
      ...(message.replyToMessageId ? { replyToMessageId: message.replyToMessageId } : {}),
      ...(ids.length ? { mentionMemberIds: ids } : {}),
    });
  const resolvedQuote = useDraftQuote(
    { memberId: viewer.id, role: viewer.role, ticketId: ticket.id },
    message.kind,
    message.replyToMessageId,
  );
  const quote = resolvedQuote.quote;
  useEffect(() => {
    if (!replyTarget) return;
    const kind = replyTarget.kind === 'note' ? 'note' : message.kind;
    setReferences(kind, { ...draft.references?.[kind], replyToMessageId: replyTarget.id });
    if (kind !== message.kind) selectKind(kind);
    onClearReply();
  }, [replyTarget, message.kind, draft.references, setReferences, selectKind, onClearReply]);
  return (
    <form
      className={`composer ticket-chat-composer ${message.kind}`}
      onSubmit={async event => {
        event.preventDefault();
        if (
          busy ||
          saving.current ||
          !message.body.trim() ||
          !attachments.canSubmit ||
          resolvedQuote.loading ||
          resolvedQuote.error
        )
          return;
        if (message.kind === 'reply' && PENDING_PLACEHOLDER.test(message.body)) {
          setPendingWarning(true);
          return;
        }
        setPendingWarning(false);
        saving.current = true;
        try {
          const payload = { ...message, ...attachments.payload(), bodyFormat: 'markdown' as const };
          const operations = getDraftOperations();
          if (await onSave({ ...payload, operationId: operations.forPayload(scope, payload) })) {
            complete(message);
            attachments.complete();
            operations.clear(scope);
          }
        } finally {
          saving.current = false;
        }
      }}
    >
      <div className="composer-tabs">
        <button
          type="button"
          className={message.kind === 'reply' ? 'chosen' : ''}
          disabled={busy || attachments.busy}
          aria-pressed={message.kind === 'reply'}
          onClick={() => selectKind('reply')}
        >
          <MessageSquare size={15} />
          Respuesta
        </button>
        <button
          type="button"
          className={message.kind === 'note' ? 'chosen' : ''}
          disabled={busy || attachments.busy}
          aria-pressed={message.kind === 'note'}
          onClick={() => selectKind('note')}
        >
          <ShieldCheck size={15} />
          Nota interna
        </button>
      </div>
      <details className="ticket-chat-saved-replies">
        <summary>
          <Sparkles size={15} />
          Respuestas guardadas
        </summary>
        <SavedReplyPicker
          replies={savedReplies}
          busy={busy}
          onInsert={body => edit(message.body ? `${message.body}\n\n${body}` : body)}
        />
      </details>
      {bitaDraft && message.kind === 'reply' && (
        <BitaDraft
          ticketId={ticket.id}
          disabled={busy}
          onDraft={text => {
            edit(withDraft(latestBody.current, text));
            setPendingWarning(false);
          }}
        />
      )}
      {draft.recoveredLegacy && (
        <p className="draft-notice" role="status">
          Recuperamos un borrador anterior como nota interna para mantenerlo privado. Revísalo antes de guardarlo.
        </p>
      )}
      {!persistent && (
        <p className="draft-notice" role="status">
          Tu navegador no permite guardar este borrador al recargar. Conservaremos el texto mientras esta página siga
          abierta.
        </p>
      )}
      {message.replyToMessageId && (
        <div className="ticket-reply-banner">
          <span>
            <strong>
              {quote
                ? `Respondiendo a ${quote.author}${quote.kind === 'note' ? ' · Nota interna' : ''}`
                : resolvedQuote.loading
                  ? 'Comprobando cita…'
                  : 'Cita pendiente de comprobar'}
            </strong>
            {quote && <small>{quote.body.slice(0, 180)}</small>}
            {resolvedQuote.error && (
              <>
                <small role="alert">{resolvedQuote.error}</small>
                <button type="button" className="text-button" onClick={resolvedQuote.retry}>
                  Reintentar cita
                </button>
              </>
            )}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Quitar cita"
            onClick={() => setReferences(message.kind, mentionIds.length ? { mentionMemberIds: mentionIds } : {})}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {collaboration && message.kind === 'note' && (
        <div className="ticket-mention-picker">
          <label>
            Mencionar a
            <select
              aria-label="Mencionar a un compañero"
              value=""
              disabled={busy || mentionIds.length >= 10}
              onChange={event => {
                const person = members.find(member => member.id === event.target.value);
                if (person && mentionIds.length < 10 && !mentionIds.includes(person.id)) {
                  setMentionIds([...mentionIds, person.id]);
                  edit(`${message.body}${message.body ? ' ' : ''}@${person.name} `);
                }
              }}
            >
              <option value="">Seleccionar compañero…</option>
              {members
                .filter(
                  person =>
                    person.status === 'active' &&
                    person.hasAccount &&
                    person.role !== 'client' &&
                    person.id !== viewer.id &&
                    !mentionIds.includes(person.id),
                )
                .map(person => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
            </select>
          </label>
          {mentionIds.map(id => (
            <button
              type="button"
              key={id}
              onClick={() => setMentionIds(mentionIds.filter(item => item !== id))}
              aria-label={`Quitar mención a ${members.find(person => person.id === id)?.name || 'compañero'}`}
            >
              @{members.find(person => person.id === id)?.name || 'Compañero anterior'}
              <X size={12} />
            </button>
          ))}
        </div>
      )}
      <MessageEditor
        compact
        label={message.kind === 'note' ? 'Escribir nota interna' : 'Escribir respuesta'}
        value={message.body}
        disabled={busy}
        onChange={value => {
          edit(value);
          notifyTicketPresenceActivity(ticket.id, message.kind);
        }}
        placeholder={
          message.kind === 'note'
            ? 'Añade contexto para el seguimiento del caso…'
            : 'Escribe una respuesta clara y cercana…'
        }
      />
      <AttachmentComposer controls={attachments} disabled={busy} />
      {pendingWarning && message.kind === 'reply' && PENDING_PLACEHOLDER.test(message.body) && (
        <p className="draft-notice bita-draft-pending" role="alert">
          La respuesta todavía tiene partes marcadas «[completar: …]». Escríbelas o bórralas antes de enviar.
        </p>
      )}
      <div className="composer-footer">
        <small>
          {message.kind === 'reply'
            ? ticket.requesterMemberId
              ? 'El cliente podrá verla en su portal. El aviso por correo se registra por separado.'
              : 'Vincula una cuenta de cliente para que pueda consultar esta respuesta en su portal.'
            : 'Solo visible para tu equipo. No se envía al cliente.'}
        </small>
        <button
          className="primary"
          disabled={
            busy ||
            !message.body.trim() ||
            !attachments.canSubmit ||
            resolvedQuote.loading ||
            Boolean(resolvedQuote.error)
          }
        >
          {busy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}{' '}
          {busy ? 'Guardando…' : message.kind === 'note' ? 'Guardar nota' : 'Enviar respuesta'}
        </button>
      </div>
    </form>
  );
}
