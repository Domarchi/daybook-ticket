'use client';
import { daybookFetch } from '@/lib/browser-request';
import { useEffect, useState } from 'react';
import { Tags } from 'lucide-react';
import { describeSuggestion } from '../lib/ticket-backfill-model';
import type { BackfillPreviewItem } from '../lib/ticket-backfill';
import './classify-backfill.css';

type Preview = { total: number; limit: number; items: BackfillPreviewItem[] };
const number = (id: number) => `#${String(id).padStart(4, '0')}`;
const HIDDEN_KEY = 'daybook:classify-backfill-hidden';

function hiddenForSession(): boolean {
  try {
    return sessionStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Administrators: tickets created before the classifier show «Sin clasificar». This lists what the classifier
 * would suggest; the person unticks what looks wrong and applies the rest. Applied suggestions say «Sugerida» on
 * the ticket and can still be corrected there; unticked tickets stay unclassified.
 */
export function ClassifyBackfill({
  memberId,
  refreshKey,
  onApplied,
}: {
  memberId: string;
  refreshKey?: string | number;
  onApplied: () => void;
}) {
  const [reload, setReload] = useState(0);
  const key = `${memberId}:${refreshKey ?? ''}:${reload}`;
  const [state, setState] = useState<{ key: string; preview: Preview | null }>({ key: '', preview: null });
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(hiddenForSession);
  const [chosen, setChosen] = useState<Set<number> | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'done' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    daybookFetch('/api/tickets/classify', {
      cache: 'no-store',
      headers: { 'X-Daybook-Member-Id': memberId },
      signal: controller.signal,
    })
      .then(async response => {
        if (response.ok) setState({ key, preview: (await response.json()) as Preview });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [memberId, key]);

  const preview = state.preview;
  if (!preview || hidden || (!preview.total && !message)) return null;
  // High-confidence suggestions start ticked; low-confidence ones wait for a person to look.
  const selected =
    chosen ?? new Set(preview.items.filter(item => item.confidence === 'high').map(item => item.ticketId));
  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  };

  const apply = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await daybookFetch('/api/tickets/classify', {
        method: 'POST',
        headers: { 'X-Daybook-Member-Id': memberId, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketIds: [...selected] }),
      });
      const body = (await response.json().catch(() => ({}))) as { applied?: number; skipped?: number; error?: string };
      if (!response.ok) throw new Error(body.error || 'No se pudo clasificar.');
      const applied = body.applied ?? 0;
      setMessage({
        kind: 'done',
        text: `${applied === 1 ? 'Se clasificó 1 ticket' : `Se clasificaron ${applied} tickets`}${
          body.skipped ? ` (${body.skipped} ya tenían clasificación y no se tocaron)` : ''
        }. Puedes corregir cualquiera desde el ticket.`,
      });
      setChosen(null);
      setReload(value => value + 1);
      onApplied();
    } catch (error) {
      setMessage({ kind: 'error', text: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const status = message && (
    <p
      className={message.kind === 'error' ? 'backfill-error' : 'backfill-done'}
      role={message.kind === 'error' ? 'alert' : 'status'}
    >
      {message.text}
    </p>
  );

  if (!preview.total)
    return (
      <section className="classify-backfill" aria-label="Clasificación de tickets antiguos">
        {status}
      </section>
    );

  return (
    <section className="classify-backfill" aria-labelledby="classify-backfill-title">
      <div className="backfill-head">
        <Tags size={17} aria-hidden="true" />
        <div>
          <h2 id="classify-backfill-title">
            {preview.total === 1 ? '1 ticket sin clasificar' : `${preview.total} tickets sin clasificar`}
          </h2>
          <p>Son anteriores al clasificador. Revisa lo que sugiere y aplica solo lo que esté bien.</p>
        </div>
        <div className="backfill-head-actions">
          <button type="button" className="secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>
            {open ? 'Ocultar sugerencias' : 'Revisar sugerencias'}
          </button>
          {!open && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                try {
                  sessionStorage.setItem(HIDDEN_KEY, '1');
                } catch {
                  // Without storage the notice simply comes back on the next load.
                }
                setHidden(true);
              }}
            >
              Ahora no
            </button>
          )}
        </div>
      </div>
      {status}
      {open && (
        <>
          {preview.total > preview.items.length && (
            <p className="backfill-note">
              Se muestran los {preview.items.length} más antiguos. Al aplicar aparecerán los siguientes.
            </p>
          )}
          <ul className="backfill-list">
            {preview.items.map(item => {
              const id = `backfill-${item.ticketId}`;
              return (
                <li key={item.ticketId} className={item.confidence === 'low' ? 'is-low' : ''}>
                  <input
                    id={id}
                    type="checkbox"
                    checked={selected.has(item.ticketId)}
                    onChange={() => toggle(item.ticketId)}
                  />
                  <label htmlFor={id}>
                    <strong>
                      {number(item.ticketId)} · {item.subject}
                    </strong>
                    <span>
                      {describeSuggestion(item)}
                      {item.confidence === 'low' && (
                        <em className="backfill-low"> · Sugerencia poco segura: revísala</em>
                      )}
                    </span>
                    <small>
                      {item.requesterName}
                      {item.matched.length ? ` · por: ${item.matched.join(', ')}` : ''}
                    </small>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="backfill-actions">
            <button type="button" className="text-button" onClick={() => setChosen(new Set())}>
              Desmarcar todo
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setChosen(new Set(preview.items.map(item => item.ticketId)))}
            >
              Marcar todo
            </button>
            <button type="button" className="primary" disabled={saving || !selected.size} onClick={apply}>
              {saving
                ? 'Clasificando…'
                : selected.size === 1
                  ? 'Clasificar 1 ticket'
                  : `Clasificar ${selected.size} tickets`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
