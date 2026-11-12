'use client';
/**
 * Bita's chat: a button in the top bar that opens a panel to ask about the desk and about how to solve a ticket.
 * Read-only (see `app/api/assistant/route.ts`).
 *
 * Loaded with `next/dynamic` from the desk, and only when the server says Bita is available for this person
 * (`app/page.tsx`): whoever does not have it downloads none of this. The conversation lives only in this tab's memory:
 * the server keeps none, and a reload starts over.
 *
 * What it shows without spending messages: the desk summary when the panel opens (`/api/assistant/summary`, fixed
 * rules) and ticket numbers in answers turned into links.
 */
import { BrowserJsonError, readDaybookJson } from '@/lib/browser-json';
import { daybookFetch } from '@/lib/browser-request';
import {
  ASSISTANT_NAME,
  SUGGESTED_QUESTIONS,
  firstName,
  hourInChile,
  introduction,
  isChatResponse,
  isSummaryResponse,
  splitWithLinks,
  summaryLines,
  type DeskSummaryView,
} from '@/lib/assistant-ui';
import { X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { BitaAvatar } from './bita-avatar';
import './bita.css';

type ChatEntry = { id: number; role: 'user' | 'assistant'; content: string };
export type BitaRequest = { id: number; text: string } | null;

/** Messages sent per request. The server trims to 8 on its own; this only avoids sending more over the network. */
const MESSAGES_SENT = 12;
const MAX_LENGTH = 2000;
/** The summary is fetched again if the panel opens after this long. */
const SUMMARY_FRESH_MS = 2 * 60 * 1000;

function TextWithLinks({
  text,
  onOpenTicket,
  onOpenKnowledge,
}: {
  text: string;
  onOpenTicket: (id: number) => void;
  onOpenKnowledge: () => void;
}) {
  return (
    <>
      {splitWithLinks(text).map((piece, index) =>
        piece.kind === 'text' ? (
          <span key={index}>{piece.text}</span>
        ) : piece.kind === 'ticket' ? (
          <button
            key={index}
            type="button"
            className="bita-link"
            aria-label={`Abrir el ticket ${piece.id}`}
            onClick={() => onOpenTicket(piece.id)}
          >
            {piece.text}
          </button>
        ) : (
          <button
            key={index}
            type="button"
            className="bita-link"
            aria-label={`Abrir la base de conocimiento (artículo ${piece.id})`}
            onClick={onOpenKnowledge}
          >
            {piece.text}
          </button>
        ),
      )}
    </>
  );
}

async function post(messages: ChatEntry[]) {
  const response = await daybookFetch(
    '/api/assistant',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages
          .slice(-MESSAGES_SENT)
          .map(({ role, content }) => ({ role, content: content.slice(0, MAX_LENGTH) })),
      }),
    },
    `${ASSISTANT_NAME} no pudo contestar: se cortó la conexión. Intenta de nuevo.`,
  );
  return readDaybookJson(response, { validate: isChatResponse });
}

export default function Bita({
  name,
  request,
  onOpenTicket,
  onOpenKnowledge,
}: {
  name: string;
  /** A question asked from elsewhere (the ticket's "Pedir a Bita"): opening the panel sends it. */
  request: BitaRequest;
  onOpenTicket: (id: number) => void;
  onOpenKnowledge: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [summary, setSummary] = useState<DeskSummaryView | null>(null);
  const [summaryState, setSummaryState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const nextId = useRef(1);
  const summaryAt = useRef(0);
  const handledRequest = useRef<number | null>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const panelId = useId();

  // The hour is fixed when the panel opens: the greeting does not change while it is being read.
  const greeting = useMemo(() => (open ? introduction(firstName(name), hourInChile()) : ''), [open, name]);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      field.current?.focus();
    } else if (wasOpen.current) launcher.current?.focus();
  }, [open]);

  // The summary is a useful extra: if it cannot be read, the greeting shows without it and a short note says so.
  useEffect(() => {
    if (!open || Date.now() - summaryAt.current < SUMMARY_FRESH_MS) return;
    summaryAt.current = Date.now();
    const controller = new AbortController();
    setSummaryState('loading');
    daybookFetch('/api/assistant/summary', { signal: controller.signal })
      .then(response => readDaybookJson(response, { validate: isSummaryResponse }))
      .then(data => {
        setSummary(data.summary);
        if (data.remaining !== null) setRemaining(data.remaining);
        setSummaryState('idle');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        summaryAt.current = 0;
        setSummaryState('failed');
      });
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    const zone = log.current;
    if (zone) zone.scrollTop = zone.scrollHeight;
  }, [entries, sending, error]);

  const send = useCallback(
    async (content: string) => {
      const clean = content.trim();
      if (!clean || sending) return;
      const mine: ChatEntry = { id: nextId.current++, role: 'user', content: clean };
      const conversation = [...entries, mine];
      setEntries(conversation);
      setText('');
      setError(null);
      setSending(true);
      try {
        const answer = await post(conversation);
        setEntries(current => [...current, { id: nextId.current++, role: 'assistant', content: answer.reply }]);
        setRemaining(answer.remaining);
      } catch (failure) {
        // The unanswered message leaves the conversation and goes back to the field, to resend it with one tap.
        setEntries(current => current.filter(entry => entry.id !== mine.id));
        setText(clean);
        setError(
          failure instanceof BrowserJsonError || failure instanceof Error
            ? failure.message
            : `${ASSISTANT_NAME} no pudo contestar. Intenta de nuevo.`,
        );
      } finally {
        setSending(false);
        if (window.matchMedia('(pointer: fine)').matches) field.current?.focus();
      }
    },
    [entries, sending],
  );

  // A question from the ticket page: open and send it once, even if React runs the effect twice.
  useEffect(() => {
    if (!request || handledRequest.current === request.id) return;
    handledRequest.current = request.id;
    setOpen(true);
    void send(request.text);
  }, [request, send]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(text);
  };
  // Enter sends; Shift+Enter is a new line. Escape closes the panel.
  const onFieldKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(text);
    }
  };
  const onPanelKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setOpen(false);
    }
  };
  const openTicket = (id: number) => {
    // On a phone the panel covers the page: close it so the ticket is visible.
    if (window.matchMedia('(max-width: 750px)').matches) setOpen(false);
    onOpenTicket(id);
  };

  return (
    <>
      {!open && (
        <button
          ref={launcher}
          type="button"
          className="bita-launcher"
          aria-expanded={false}
          aria-label={`Abrir el chat con ${ASSISTANT_NAME}`}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          <BitaAvatar size={30} thinking={sending} />
          <span>{ASSISTANT_NAME}</span>
        </button>
      )}
      {open && (
        <section
          id={panelId}
          className="bita-panel"
          role="dialog"
          aria-label={`${ASSISTANT_NAME}, asistente de Daybook Ticket`}
          onKeyDown={onPanelKey}
        >
          <header className="bita-header">
            <div className="bita-identity">
              <BitaAvatar size={38} thinking={sending} />
              <div>
                <h2>{ASSISTANT_NAME}</h2>
                <small>Bandeja, SLA y sugerencias para resolver tickets</small>
              </div>
            </div>
            <button
              type="button"
              className="bita-close"
              onClick={() => setOpen(false)}
              aria-label={`Cerrar el chat con ${ASSISTANT_NAME}`}
            >
              <X size={18} />
            </button>
          </header>

          <div
            ref={log}
            className="bita-log"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label="Conversación"
          >
            {entries.length === 0 && (
              <div className="bita-welcome">
                <p>{greeting}</p>
                {summary ? (
                  <ul className="bita-summary" aria-label="Cómo va la bandeja">
                    {summaryLines(summary).map(line => (
                      <li key={line.text}>
                        {line.text}
                        {line.tickets.map(id => (
                          <button
                            key={id}
                            type="button"
                            className="bita-link"
                            aria-label={`Abrir el ticket ${id}`}
                            onClick={() => openTicket(id)}
                          >
                            #{id}
                          </button>
                        ))}
                      </li>
                    ))}
                  </ul>
                ) : summaryState === 'loading' ? (
                  <p className="bita-summary-loading" role="status">
                    Revisando la bandeja…
                  </p>
                ) : summaryState === 'failed' ? (
                  <p className="bita-summary-loading">No pude leer la bandeja ahora; igual puedes preguntarme.</p>
                ) : null}
                <div className="bita-questions">
                  {SUGGESTED_QUESTIONS.map(question => (
                    <button key={question} type="button" onClick={() => void send(question)} disabled={sending}>
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {entries.map(entry =>
              entry.role === 'user' ? (
                <div key={entry.id} className="bita-message mine">
                  <span className="sr-only">Tú: </span>
                  {entry.content}
                </div>
              ) : (
                <div key={entry.id} className="bita-row">
                  <BitaAvatar size={26} />
                  <div className="bita-message hers">
                    <span className="sr-only">{ASSISTANT_NAME}: </span>
                    <TextWithLinks text={entry.content} onOpenTicket={openTicket} onOpenKnowledge={onOpenKnowledge} />
                  </div>
                </div>
              ),
            )}
            {sending && (
              <div className="bita-status" role="status">
                <span>{ASSISTANT_NAME} está revisando los tickets</span>
                <span className="bita-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            )}
            {error && (
              <div className="bita-error" role="alert">
                {error}
              </div>
            )}
          </div>

          <form className="bita-form" onSubmit={onSubmit}>
            <textarea
              ref={field}
              value={text}
              rows={1}
              maxLength={MAX_LENGTH}
              placeholder={`Escríbele a ${ASSISTANT_NAME}`}
              aria-label="Tu pregunta"
              onChange={event => setText(event.target.value)}
              onKeyDown={onFieldKey}
            />
            <button type="submit" className="primary" disabled={sending || !text.trim()}>
              Enviar
            </button>
          </form>
          <div className="bita-footer">
            {remaining !== null ? `Te quedan ${remaining} ${remaining === 1 ? 'mensaje' : 'mensajes'} hoy. ` : ''}
            {ASSISTANT_NAME} puede equivocarse: revisa el ticket antes de actuar. Nunca responde al cliente por ti.
          </div>
        </section>
      )}
    </>
  );
}
