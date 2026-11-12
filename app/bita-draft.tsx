'use client';
/**
 * "Borrador con Bita" in the reply composer (feature 3). One click asks Bita for a draft of the reply to the customer
 * and puts it in the composer, below whatever the person already wrote. The person reviews it and sends it; Bita never
 * sends anything. Each draft spends one message of the daily quota, shared with the chat.
 *
 * Shown only when Bita is available for this person, and only on the "Respuesta" tab.
 */
import { readDaybookJson } from '@/lib/browser-json';
import { daybookFetch } from '@/lib/browser-request';
import { isDraftResponse } from '@/lib/assistant-ui';
import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { BitaAvatar } from './bita-avatar';
import './bita.css';

export function BitaDraft({
  ticketId,
  disabled,
  onDraft,
}: {
  ticketId: number;
  disabled: boolean;
  onDraft: (draft: string) => void;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'failed'>('idle');
  const [note, setNote] = useState('');

  const ask = async () => {
    setState('loading');
    setNote('');
    try {
      const response = await daybookFetch(`/api/assistant/tickets/${ticketId}/draft`, { method: 'POST' });
      const result = await readDaybookJson(response, { validate: isDraftResponse });
      const left = `Te quedan ${result.remaining} ${result.remaining === 1 ? 'mensaje' : 'mensajes'} de Bita hoy.`;
      if (result.draft === null) {
        setNote(`${result.notice} ${left}`);
        setState('failed');
        return;
      }
      onDraft(result.draft);
      setNote(
        `${result.cut ? 'El borrador quedó cortado: complétalo. ' : ''}Revisa el borrador y completa lo marcado [completar: …] antes de enviar. ${left}`,
      );
      setState('done');
    } catch (failure) {
      setNote(failure instanceof Error ? failure.message : 'Bita no pudo escribir el borrador. Intenta de nuevo.');
      setState('failed');
    }
  };

  return (
    <div className="bita-draft">
      <button
        type="button"
        className="secondary"
        onClick={() => void ask()}
        disabled={disabled || state === 'loading'}
        aria-describedby={note ? `bita-draft-note-${ticketId}` : undefined}
      >
        {state === 'loading' ? <LoaderCircle size={15} className="spin" /> : <BitaAvatar size={20} />}
        {state === 'loading' ? 'Bita está escribiendo…' : 'Borrador con Bita'}
      </button>
      {note && (
        <p
          id={`bita-draft-note-${ticketId}`}
          className={state === 'failed' ? 'bita-draft-note failed' : 'bita-draft-note'}
          role={state === 'failed' ? 'alert' : 'status'}
        >
          {note}
        </p>
      )}
    </div>
  );
}
