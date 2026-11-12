'use client';
/**
 * "Sugerir solución" inside a ticket (feature 2). The first button costs nothing: it shows the classifier's category,
 * the most similar solved tickets with the team's reply, and related knowledge articles, all from fixed rules. The
 * second button hands the ticket to Bita's chat, which writes diagnosis and solution steps citing those sources and
 * spends one message of the daily quota.
 *
 * "Resumir ticket" (feature 4) recaps a long ticket for whoever picks it up halfway: a short ticket gets a notice and
 * costs nothing; a long one spends one message. The recap stays in this box, for the team; it is never sent.
 *
 * Shown only when Bita is available for this person; it never writes to the ticket.
 */
import { readDaybookJson } from '@/lib/browser-json';
import { daybookFetch } from '@/lib/browser-request';
import {
  askForSolution,
  isRecapResponse,
  isSuggestionsResponse,
  recapLines,
  type SuggestionsView,
} from '@/lib/assistant-ui';
import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { BitaAvatar } from './bita-avatar';
import './bita.css';

export function BitaSuggestions({
  ticketId,
  onAsk,
  onOpenTicket,
}: {
  ticketId: number;
  onAsk: (text: string) => void;
  onOpenTicket: (id: number) => void;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [data, setData] = useState<SuggestionsView | null>(null);
  const [error, setError] = useState('');
  const [recapState, setRecapState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [recap, setRecap] = useState<{ text: string | null; note: string }>({ text: null, note: '' });

  const summarize = async () => {
    setRecapState('loading');
    try {
      const response = await daybookFetch(`/api/assistant/tickets/${ticketId}/recap`, { method: 'POST' });
      const result = await readDaybookJson(response, { validate: isRecapResponse });
      const left =
        result.remaining === null
          ? ''
          : ` Te quedan ${result.remaining} ${result.remaining === 1 ? 'mensaje' : 'mensajes'} de Bita hoy.`;
      setRecap(
        result.recap === null
          ? { text: null, note: `${result.notice}${left}` }
          : {
              text: result.recap,
              note: `${result.cut ? 'El resumen quedó cortado. ' : ''}Resumen hecho con IA: revisa la conversación antes de actuar.${left}`,
            },
      );
      setRecapState('ready');
    } catch (failure) {
      setRecap({ text: null, note: failure instanceof Error ? failure.message : 'Bita no pudo resumir el ticket.' });
      setRecapState('failed');
    }
  };

  const load = async () => {
    setState('loading');
    setError('');
    try {
      const response = await daybookFetch(`/api/assistant/tickets/${ticketId}/suggestions`);
      const result = await readDaybookJson(response, { validate: isSuggestionsResponse });
      setData(result.suggestions);
      setState('ready');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudieron leer las sugerencias.');
      setState('failed');
    }
  };

  return (
    <section className="bita-suggestions" aria-label="Sugerencias de Bita">
      <div className="bita-suggestions-head">
        <div>
          <BitaAvatar size={26} />
          <strong>Bita en este ticket</strong>
        </div>
        <div className="bita-suggestions-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => void summarize()}
            disabled={recapState === 'loading'}
          >
            {recapState === 'loading' && <LoaderCircle size={15} className="spin" />}
            {recapState === 'loading' ? 'Resumiendo…' : 'Resumir ticket'}
          </button>
          <button type="button" className="secondary" onClick={() => void load()} disabled={state === 'loading'}>
            {state === 'loading' && <LoaderCircle size={15} className="spin" />}
            {state === 'ready' ? 'Volver a buscar' : 'Sugerir solución'}
          </button>
          <button type="button" className="secondary" onClick={() => onAsk(askForSolution(ticketId))}>
            Pedir pasos a Bita
          </button>
        </div>
      </div>
      {recapState === 'failed' && (
        <p className="bita-suggestions-note" role="alert">
          {recap.note}
        </p>
      )}
      {recapState === 'ready' && (
        <div className="bita-recap" role="status" aria-label="Resumen de Bita">
          {recap.text && (
            <>
              <h3>Resumen para quien toma el ticket</h3>
              <ul>
                {recapLines(recap.text).map((line, index) => (
                  <li key={index} className={line.label ? 'labeled' : undefined}>
                    {line.label && <strong>{line.label} </strong>}
                    {line.text}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="bita-suggestions-note">{recap.note}</p>
        </div>
      )}
      {state === 'failed' && (
        <p className="bita-suggestions-note" role="alert">
          {error}
        </p>
      )}
      {state === 'ready' && data && (
        <div className="bita-suggestions-body" role="status">
          <h3>¿Cómo se resolvió algo parecido?</h3>
          <p>
            Categoría propuesta: <strong>{data.categoria.etiqueta}</strong> (confianza {data.categoria.confianza}
            {data.categoria.palabras.length ? `; por «${data.categoria.palabras.join(', ')}»` : ''}).
          </p>
          <h3>Tickets solucionados parecidos</h3>
          {data.similares.length ? (
            <ul>
              {data.similares.map(item => (
                <li key={item.numero}>
                  <button
                    type="button"
                    className="bita-link"
                    aria-label={`Abrir el ticket ${item.numero}`}
                    onClick={() => onOpenTicket(item.numero)}
                  >
                    #{item.numero}
                  </button>{' '}
                  {item.asunto}
                  {item.misma_categoria && <span className="bita-tag">misma categoría</span>}
                  {item.respuesta_del_equipo && <p>Respuesta del equipo: {item.respuesta_del_equipo}</p>}
                  {!item.respuesta_del_equipo && item.nota_interna && <p>Nota interna: {item.nota_interna}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="bita-suggestions-note">No encontré tickets solucionados con palabras en común.</p>
          )}
          <h3>Base de conocimiento</h3>
          {data.articulos.length ? (
            <ul>
              {data.articulos.map(item => (
                <li key={item.articulo}>
                  Artículo A{item.articulo}: {item.titulo}
                  {item.estado !== 'aprobado' && <span className="bita-tag">{item.estado}</span>}
                  {item.extracto && <p>{item.extracto}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="bita-suggestions-note">No hay artículos relacionados.</p>
          )}
          <p className="bita-suggestions-note">
            Buscado por: {data.palabras_buscadas.join(', ') || 'sin palabras útiles en el asunto'}. Esto no usa IA ni
            gasta mensajes; «Pedir pasos a Bita» sí gasta uno.
          </p>
        </div>
      )}
    </section>
  );
}
