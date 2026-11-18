'use client';
import { daybookFetch } from '@/lib/browser-request';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Laptop } from 'lucide-react';
import {
  EQUIPMENT_KINDS,
  equipmentLabel,
  ownEquipmentNeed,
  type EquipmentItem,
  type OwnEquipment,
} from '../lib/client-equipment-model';
import './equipment-panel.css';

async function readEquipment(memberId: string, path: string, signal: AbortSignal): Promise<OwnEquipment[]> {
  const response = await daybookFetch(path, {
    cache: 'no-store',
    headers: { 'X-Daybook-Member-Id': memberId },
    signal,
  });
  if (!response.ok) throw new Error('Equipment unavailable');
  const body = (await response.json()) as { equipment?: OwnEquipment[] };
  return Array.isArray(body.equipment) ? body.equipment : [];
}

/** The signed-in person's equipment. Empty while loading or when the request fails: it is a convenience, never a gate. */
export function useOwnEquipment(memberId: string): OwnEquipment[] {
  return useOwnEquipmentState(memberId).items;
}

/** The same, saying whether it was read, and a way to read it again after the person changes it (Fase 7, L4). */
export function useOwnEquipmentState(memberId: string): {
  items: OwnEquipment[];
  loaded: boolean;
  reload: () => void;
} {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; items: OwnEquipment[] }>({ key: '', items: [] });
  const key = `${memberId}:${revision}`;
  useEffect(() => {
    const controller = new AbortController();
    readEquipment(memberId, '/api/equipment/mine', controller.signal)
      .then(items => setState({ key, items }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [memberId, key]);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  // While re-reading, the previous list stays: the card does not flicker back to a form.
  const loaded = state.key.startsWith(`${memberId}:`);
  return { items: loaded ? state.items : [], loaded, reload };
}

/**
 * Staff creating a ticket for a client: that client's active equipment, read from the inventory once a client is
 * chosen. Empty while loading, on failure or without a client: choosing equipment is optional, never a gate.
 */
export function useClientEquipment(viewerId: string, clientId: string): OwnEquipment[] {
  const [state, setState] = useState<{ viewerId: string; items: EquipmentItem[] } | null>(null);
  const needed = Boolean(clientId) && state?.viewerId !== viewerId;
  useEffect(() => {
    if (!needed) return;
    const controller = new AbortController();
    daybookFetch('/api/equipment?filter=assigned', {
      cache: 'no-store',
      headers: { 'X-Daybook-Member-Id': viewerId },
      signal: controller.signal,
    })
      .then(async response => {
        if (!response.ok) throw new Error('Equipment unavailable');
        const body = (await response.json()) as { equipment?: EquipmentItem[] };
        setState({ viewerId, items: Array.isArray(body.equipment) ? body.equipment : [] });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [viewerId, needed]);
  if (!clientId || state?.viewerId !== viewerId) return [];
  return state.items.filter(item => item.assignedMemberId === clientId);
}

/** "Mis equipos" in the client portal. */
export function OwnEquipmentStrip({ items }: { items: OwnEquipment[] }) {
  if (!items.length) return null;
  return (
    <section className="own-equipment" aria-labelledby="own-equipment-title">
      <h2 id="own-equipment-title">
        <Laptop size={17} aria-hidden="true" />
        Mis equipos
      </h2>
      <ul>
        {items.map(item => (
          <li key={item.id}>
            <strong>{item.assetTag ?? item.name}</strong>
            <span>
              {item.category}
              {item.model ? ` · ${item.model}` : ''}
              {item.serial ? ` · Serie ${item.serial}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The equipment a ticket is about, shown to whoever handles it. Renders nothing when the ticket names none. */
export function TicketEquipment({ memberId, ticketId }: { memberId: string; ticketId: number }) {
  const [state, setState] = useState<{ key: string; items: OwnEquipment[] }>({ key: '', items: [] });
  const key = `${memberId}:${ticketId}`;
  useEffect(() => {
    const controller = new AbortController();
    readEquipment(memberId, `/api/tickets/${ticketId}/equipment`, controller.signal)
      .then(items => setState({ key, items }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [memberId, ticketId, key]);
  const items = state.key === key ? state.items : [];
  if (!items.length) return null;
  return (
    <div className="ticket-equipment">
      <span className="eyebrow">EQUIPO</span>
      <ul>
        {items.map(item => (
          <li key={item.id}>
            <Laptop size={15} aria-hidden="true" />
            <span>
              <strong>{equipmentLabel(item)}</strong>
              {item.model && <small>{item.model}</small>}
              {item.serial && <small>Serie {item.serial}</small>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function save(memberId: string, path: string, method: 'POST' | 'PATCH', body: unknown): Promise<void> {
  const response = await daybookFetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Daybook-Member-Id': memberId },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const result: { error?: unknown } = await response.json().catch(() => ({}));
    throw new Error(typeof result.error === 'string' ? result.error : 'No se pudo guardar. Inténtalo de nuevo.');
  }
}

/**
 * «Confirma tu equipo» in the client portal (Fase 7, L4): shown while the person has no equipment or one without its
 * serial number. They fill in what is missing; what is already recorded is corrected by the team, from a ticket.
 */
export function ConfirmEquipmentCard({
  memberId,
  items,
  loaded,
  hasCompany,
  onSaved,
  onNewTicket,
}: {
  memberId: string;
  items: OwnEquipment[];
  loaded: boolean;
  hasCompany: boolean;
  onSaved: () => void;
  onNewTicket: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState('');
  const need = loaded ? ownEquipmentNeed(items, hasCompany) : null;
  if (!need)
    return done ? (
      <p className="confirm-equipment-done" role="status">
        <CheckCircle2 size={17} aria-hidden="true" />
        {done}
      </p>
    ) : null;

  const submit = async (event: FormEvent<HTMLFormElement>, path: string, method: 'POST' | 'PATCH', message: string) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const model = String(values.get('model') ?? '').trim();
    setBusy(true);
    setError('');
    try {
      await save(memberId, path, method, {
        ...(method === 'POST'
          ? { assetTag: String(values.get('assetTag') ?? ''), kind: String(values.get('kind') ?? 'computer') }
          : {}),
        serial: String(values.get('serial') ?? ''),
        ...(model ? { model } : {}),
      });
      setDone(message);
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  };
  const fields = (
    <>
      <label>
        N° de serie
        <input
          name="serial"
          required
          maxLength={120}
          autoComplete="off"
          placeholder="Como en la etiqueta del fabricante"
          disabled={busy}
        />
      </label>
      <label>
        Marca y modelo (opcional)
        <input name="model" maxLength={120} autoComplete="off" placeholder="Ej.: Dell Latitude 5440" disabled={busy} />
      </label>
    </>
  );
  return (
    <section className="confirm-equipment" aria-labelledby="confirm-equipment-title">
      <h2 id="confirm-equipment-title">
        <Laptop size={17} aria-hidden="true" />
        Confirma tu equipo
      </h2>
      {need.kind === 'no-company' ? (
        <p>
          Tu cuenta aún no tiene empresa, así que el equipo de soporte registrará tu equipo.{' '}
          <button type="button" className="text-button" onClick={onNewTicket}>
            Crear un ticket
          </button>
        </p>
      ) : need.kind === 'register' ? (
        <>
          <p>
            Registra el equipo que usas: así el equipo de soporte sabe de qué equipo hablas cuando pides ayuda. El ID
            está en la etiqueta de inventario y la serie, en la etiqueta del fabricante (debajo o detrás del equipo).
          </p>
          <form
            className="form confirm-equipment-form"
            onSubmit={event => void submit(event, '/api/equipment/mine', 'POST', 'Equipo registrado. ¡Gracias!')}
          >
            <label>
              ID del equipo
              <input
                name="assetTag"
                required
                maxLength={64}
                autoComplete="off"
                placeholder="Ej.: NB-0042"
                disabled={busy}
              />
            </label>
            <label>
              Tipo de equipo
              <select name="kind" defaultValue="computer" disabled={busy}>
                {EQUIPMENT_KINDS.map(kind => (
                  <option key={kind.id} value={kind.id}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </label>
            {fields}
            <button className="primary" disabled={busy}>
              Registrar mi equipo
            </button>
          </form>
        </>
      ) : (
        <>
          <p>
            Falta el número de serie {need.items.length === 1 ? 'de tu equipo' : 'de tus equipos'}. Está en la etiqueta
            del fabricante, debajo o detrás del equipo.
          </p>
          {need.items.map(item => (
            <form
              key={item.id}
              className="form confirm-equipment-form"
              aria-label={`Completar ${equipmentLabel(item)}`}
              onSubmit={event =>
                void submit(event, `/api/equipment/mine/${item.id}`, 'PATCH', 'Datos del equipo guardados. ¡Gracias!')
              }
            >
              <p className="confirm-equipment-item">
                <strong>{equipmentLabel(item)}</strong>
              </p>
              {fields}
              <button className="primary" disabled={busy}>
                Guardar serie
              </button>
            </form>
          ))}
        </>
      )}
      {error && (
        <p role="alert" className="confirm-equipment-error">
          {error}
        </p>
      )}
      <p className="confirm-equipment-note">Si algún dato registrado no es correcto, crea un ticket y lo corregimos.</p>
    </section>
  );
}
