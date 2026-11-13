'use client';
import { useState } from 'react';
import { BookOpen, Plus, Search, Trash2 } from 'lucide-react';
import { clientRequest } from '@/lib/client-request';
import type { RunAction } from './team-tools';
import { ConfirmDialog } from './desk-parts/shared';
export type SavedReplyItem = { id: string; title: string; category: string; body: string };
const searchable = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es');
function searchReplies(replies: SavedReplyItem[], query: string) {
  const needle = searchable(query.trim());
  return needle
    ? replies.filter(reply => searchable(`${reply.title} ${reply.category} ${reply.body}`).includes(needle))
    : replies;
}

export function SavedReplyPicker({
  replies,
  busy,
  onInsert,
}: {
  replies: SavedReplyItem[];
  busy: boolean;
  onInsert: (body: string) => void;
}) {
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const matchingReplies = searchReplies(replies, query);
  const reply = matchingReplies.find(item => item.id === selected);
  if (!replies.length) return null;
  return (
    <div className="saved-reply-picker">
      <label className="search-box">
        <Search size={15} />
        <span className="sr-only">Buscar respuestas guardadas para insertar</span>
        <input
          type="search"
          placeholder="Buscar título, categoría o contenido…"
          value={query}
          disabled={busy}
          onChange={event => {
            setQuery(event.target.value);
            setSelected('');
          }}
        />
      </label>
      <label>
        <BookOpen size={15} />
        <span>Respuesta guardada</span>
        <select
          value={selected}
          disabled={busy || !matchingReplies.length}
          onChange={event => setSelected(event.target.value)}
        >
          <option value="">Seleccionar una respuesta…</option>
          {matchingReplies.map(item => (
            <option value={item.id} key={item.id}>
              {item.category ? `${item.category} · ` : ''}
              {item.title}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="secondary"
        disabled={busy || !reply}
        onClick={() => {
          if (reply) {
            onInsert(reply.body);
            setSelected('');
          }
        }}
      >
        Insertar en borrador
      </button>
      {!matchingReplies.length && (
        <small role="status">No hay respuestas guardadas que coincidan con tu búsqueda.</small>
      )}
      <small>Se añade al texto actual. Revísalo antes de enviarlo.</small>
    </div>
  );
}

export function SavedRepliesManager({
  replies,
  busy,
  run,
}: {
  replies: SavedReplyItem[];
  busy: boolean;
  run: RunAction;
}) {
  const [editing, setEditing] = useState<SavedReplyItem | 'new' | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const matchingReplies = searchReplies(replies, query);
  return (
    <section className="panel saved-replies-panel">
      <div className="section-head">
        <h2>
          <BookOpen size={18} />
          Respuestas guardadas del equipo
        </h2>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            setEditing('new');
            setRemoving(null);
          }}
        >
          <Plus size={15} />
          Nueva respuesta
        </button>
      </div>
      <p className="panel-help">
        El equipo puede insertar estas respuestas y adaptarlas antes de enviar. Los administradores gestionan la
        biblioteca.
      </p>
      {editing && (
        <SavedReplyForm
          key={editing === 'new' ? 'new' : editing.id}
          reply={editing === 'new' ? undefined : editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={async body => {
            if (
              await run(
                () =>
                  clientRequest(
                    editing === 'new' ? '/api/saved-replies' : `/api/saved-replies/${editing.id}`,
                    editing === 'new' ? 'POST' : 'PATCH',
                    body,
                  ),
                'Respuesta guardada',
              )
            )
              setEditing(null);
          }}
        />
      )}
      <div className="table-tools">
        <label className="search-box">
          <Search size={17} />
          <span className="sr-only">Buscar en la biblioteca de respuestas guardadas</span>
          <input
            type="search"
            placeholder="Buscar título, categoría o contenido…"
            value={query}
            disabled={busy}
            onChange={event => setQuery(event.target.value)}
          />
        </label>
      </div>
      <ul className="saved-reply-list">
        {matchingReplies.map(reply => (
          <li key={reply.id}>
            <div>
              <strong>{reply.title}</strong>
              <small>{reply.category}</small>
              <p>
                {reply.body.slice(0, 180)}
                {reply.body.length > 180 ? '…' : ''}
              </p>
            </div>
            <div className="saved-reply-actions">
              <button type="button" className="text-button" disabled={busy} onClick={() => setEditing(reply)}>
                Editar
              </button>
              {removing === reply.id && (
                <ConfirmDialog
                  title="Eliminar respuesta guardada"
                  description={`«${reply.title}» deja de estar disponible para todo el equipo. No se puede deshacer.`}
                  confirmLabel="Eliminar respuesta"
                  busy={busy}
                  onClose={() => setRemoving(null)}
                  onConfirm={async () => {
                    // Se cierra también si falla: el aviso de error queda detrás
                    // de un diálogo nativo abierto, y ahí nadie lo lee.
                    await run(() => clientRequest(`/api/saved-replies/${reply.id}`, 'DELETE'), 'Respuesta eliminada');
                    setRemoving(null);
                  }}
                />
              )}
              {
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  aria-label={`Eliminar respuesta ${reply.title}`}
                  onClick={() => setRemoving(reply.id)}
                >
                  <Trash2 size={15} />
                </button>
              }
            </div>
          </li>
        ))}
      </ul>
      {replies.length > 0 && !matchingReplies.length && (
        <p className="panel-help" role="status">
          No hay respuestas guardadas que coincidan con tu búsqueda.
        </p>
      )}
      {!replies.length && (
        <p className="panel-help">Crea una respuesta para las consultas frecuentes de tus clientes.</p>
      )}
    </section>
  );
}
function SavedReplyForm({
  reply,
  busy,
  onCancel,
  onSave,
}: {
  reply?: SavedReplyItem;
  busy: boolean;
  onCancel: () => void;
  onSave: (body: Omit<SavedReplyItem, 'id'>) => Promise<void>;
}) {
  const [value, setValue] = useState({
    title: reply?.title || '',
    category: reply?.category || '',
    body: reply?.body || '',
  });
  return (
    <form
      className="form"
      onSubmit={event => {
        event.preventDefault();
        void onSave(value);
      }}
    >
      <div className="form-grid">
        <label>
          Título
          <input
            required
            maxLength={160}
            value={value.title}
            disabled={busy}
            onChange={event => setValue({ ...value, title: event.target.value })}
            autoFocus
          />
        </label>
        <label>
          Categoría
          <input
            required
            maxLength={80}
            value={value.category}
            disabled={busy}
            onChange={event => setValue({ ...value, category: event.target.value })}
            placeholder="Ej. Acceso, facturación"
          />
        </label>
      </div>
      <label>
        Respuesta
        <textarea
          required
          maxLength={20000}
          rows={5}
          value={value.body}
          disabled={busy}
          onChange={event => setValue({ ...value, body: event.target.value })}
        />
      </label>
      <div className="form-footer">
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
        <button
          className="primary"
          disabled={busy || !value.title.trim() || !value.category.trim() || !value.body.trim()}
        >
          Guardar respuesta
        </button>
      </div>
    </form>
  );
}
