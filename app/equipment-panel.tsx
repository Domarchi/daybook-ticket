'use client';
import { daybookFetch } from '@/lib/browser-request';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Laptop, Plus, Search, UserRoundX, X } from 'lucide-react';
import { EmptyState, SkeletonList } from './estados';
import {
  EQUIPMENT_KINDS,
  type EquipmentClient,
  type EquipmentFilter,
  type EquipmentInventory,
  type EquipmentItem,
} from '../lib/client-equipment-model';
import type { CustomerCompany } from '../lib/types';
import type { DeskRun } from './desk-parts/shared';
import './equipment-panel.css';

const FILTER_LABELS: Record<EquipmentFilter, string> = {
  all: 'Todos',
  unassigned: 'Sin asignar',
  assigned: 'Asignados',
};

async function request<T>(memberId: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await daybookFetch(path, {
    method,
    cache: 'no-store',
    headers: { 'X-Daybook-Member-Id': memberId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result && typeof result === 'object' && 'error' in result ? result.error : null;
    throw new Error(typeof message === 'string' ? message : 'No se pudo completar la operación.');
  }
  return result as T;
}

type Prefill = { companyId: string; assignedMemberId: string } | null;

/** "Equipos": the inventory by ID, who has each piece, and which clients still have none (F6-A2). */
export function EquipmentPanel({
  memberId,
  companies,
  busy,
  run,
}: {
  memberId: string;
  companies: CustomerCompany[];
  busy: boolean;
  run: DeskRun;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<EquipmentFilter>('all');
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{ data: EquipmentInventory | null; error: string; loading: boolean }>({
    data: null,
    error: '',
    loading: true,
  });
  const [form, setForm] = useState<Prefill | 'empty' | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setState(previous => ({ ...previous, loading: true }));
      try {
        const params = new URLSearchParams({ filter, ...(query.trim() ? { q: query.trim() } : {}) });
        const data = await request<EquipmentInventory>(memberId, `/api/equipment?${params}`);
        if (!cancelled) setState({ data, error: '', loading: false });
      } catch (error) {
        if (!cancelled) setState(previous => ({ ...previous, error: (error as Error).message, loading: false }));
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [memberId, query, filter, reload]);

  const clientsByCompany = useMemo(() => {
    const map = new Map<string, EquipmentClient[]>();
    for (const client of state.data?.clients ?? [])
      if (client.companyId) map.set(client.companyId, [...(map.get(client.companyId) ?? []), client]);
    return map;
  }, [state.data]);

  const refreshAfter = async (action: () => Promise<unknown>, message: string) => {
    const done = await run(action, message);
    if (done) setReload(value => value + 1);
    return done;
  };

  const data = state.data;
  return (
    <div className="equipment-panel">
      <div className="equipment-toolbar">
        <label className="equipment-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Buscar equipo</span>
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Buscar por ID, serie, cliente o empresa"
            maxLength={120}
          />
        </label>
        <div className="equipment-filters" role="group" aria-label="Mostrar">
          {(Object.keys(FILTER_LABELS) as EquipmentFilter[]).map(value => (
            <button
              key={value}
              type="button"
              className={filter === value ? 'active' : ''}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {FILTER_LABELS[value]}
            </button>
          ))}
        </div>
        <button type="button" className="primary" disabled={busy} onClick={() => setForm(form ? null : 'empty')}>
          {form ? <X size={16} /> : <Plus size={16} />}
          {form ? 'Cerrar formulario' : 'Registrar equipo'}
        </button>
      </div>

      {form && (
        <EquipmentForm
          key={form === 'empty' ? 'empty' : `${form.companyId}:${form.assignedMemberId}`}
          prefill={form === 'empty' ? null : form}
          companies={companies}
          clientsByCompany={clientsByCompany}
          busy={busy}
          onCancel={() => setForm(null)}
          onSave={async body => {
            if (
              await refreshAfter(
                () => request(memberId, '/api/equipment', 'POST', body),
                `Equipo ${body.assetTag.trim().toUpperCase()} registrado`,
              )
            )
              setForm(null);
          }}
        />
      )}

      {state.error && (
        <p className="equipment-error" role="alert">
          {state.error}
        </p>
      )}

      <section className="panel equipment-list" aria-labelledby="equipment-list-title" aria-busy={state.loading}>
        <div className="section-head">
          <h2 id="equipment-list-title">
            <Laptop size={18} aria-hidden="true" />
            Inventario
          </h2>
          <span>{data ? `${data.equipment.length} ${data.equipment.length === 1 ? 'equipo' : 'equipos'}` : ''}</span>
        </div>
        {!data && state.loading && <SkeletonList label="Cargando equipos…" rows={3} lines={1} />}
        {data && !data.equipment.length && (
          <EmptyState
            icon={<Laptop size={22} />}
            title={query || filter !== 'all' ? 'Sin coincidencias' : 'Aún no hay equipos'}
            text={
              query || filter !== 'all'
                ? 'Ningún equipo coincide con la búsqueda.'
                : 'Se registran al invitar a un cliente o con «Registrar equipo».'
            }
          />
        )}
        {data && data.equipment.length > 0 && (
          <ul className="equipment-rows">
            {data.equipment.map(item => (
              <EquipmentRow
                key={`${item.id}:${item.version}`}
                item={item}
                clients={clientsByCompany.get(item.companyId) ?? []}
                busy={busy}
                onAssign={assignedMemberId =>
                  refreshAfter(
                    () =>
                      request(memberId, `/api/equipment/${item.id}`, 'PATCH', {
                        expectedVersion: item.version,
                        assignedMemberId,
                      }),
                    assignedMemberId ? 'Equipo asignado' : 'Equipo liberado',
                  )
                }
              />
            ))}
          </ul>
        )}
      </section>

      {data && (
        <section className="panel equipment-missing" aria-labelledby="equipment-missing-title">
          <div className="section-head">
            <h2 id="equipment-missing-title">
              <UserRoundX size={18} aria-hidden="true" />
              Clientes sin equipo
            </h2>
            <span>{data.clientsWithoutEquipment.length}</span>
          </div>
          {!data.clientsWithoutEquipment.length ? (
            <p className="panel-help">Todos los clientes con acceso tienen al menos un equipo registrado.</p>
          ) : (
            <ul className="equipment-client-list">
              {data.clientsWithoutEquipment.map(client => (
                <li key={client.id}>
                  <div>
                    <strong>{client.name}</strong>
                    <span>
                      {client.email} · {client.companyName ?? 'Sin empresa'}
                    </span>
                  </div>
                  {client.companyId ? (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => setForm({ companyId: client.companyId!, assignedMemberId: client.id })}
                    >
                      Registrar su equipo<span className="sr-only"> de {client.name}</span>
                    </button>
                  ) : (
                    <small>Asígnale una empresa en «Equipo y clientes» para registrar su equipo.</small>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function EquipmentRow({
  item,
  clients,
  busy,
  onAssign,
}: {
  item: EquipmentItem;
  clients: EquipmentClient[];
  busy: boolean;
  onAssign: (assignedMemberId: string | null) => Promise<boolean>;
}) {
  const [choice, setChoice] = useState(item.assignedMemberId ?? '');
  const changed = choice !== (item.assignedMemberId ?? '');
  const label = item.assetTag ?? item.name;
  return (
    <li className="equipment-row">
      <div className="equipment-identity">
        <strong>{item.assetTag ?? 'Sin ID'}</strong>
        <span>
          {item.category}
          {item.serial ? ` · Serie ${item.serial}` : ''} · {item.companyName}
        </span>
      </div>
      <form
        className="equipment-assign"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (changed) void onAssign(choice || null);
        }}
      >
        <label>
          <span className="sr-only">Asignado a {label}</span>
          <select value={choice} onChange={event => setChoice(event.target.value)} disabled={busy}>
            <option value="">Sin asignar</option>
            {clients.map(client => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary" disabled={busy || !changed}>
          Guardar<span className="sr-only"> asignación de {label}</span>
        </button>
      </form>
    </li>
  );
}

function EquipmentForm({
  prefill,
  companies,
  clientsByCompany,
  busy,
  onCancel,
  onSave,
}: {
  prefill: Prefill;
  companies: CustomerCompany[];
  clientsByCompany: Map<string, EquipmentClient[]>;
  busy: boolean;
  onCancel: () => void;
  onSave: (body: {
    companyId: string;
    assetTag: string;
    kind: string;
    serial?: string;
    assignedMemberId: string | null;
  }) => Promise<void>;
}) {
  const [companyId, setCompanyId] = useState(prefill?.companyId ?? '');
  const [assignee, setAssignee] = useState(prefill?.assignedMemberId ?? '');
  const clients = clientsByCompany.get(companyId) ?? [];
  return (
    <section className="panel equipment-form-panel" aria-labelledby="equipment-form-title">
      <div className="section-head">
        <h2 id="equipment-form-title">Registrar equipo</h2>
      </div>
      <form
        className="form equipment-form"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          const serial = String(values.get('serial') ?? '').trim();
          void onSave({
            companyId,
            assetTag: String(values.get('assetTag') ?? ''),
            kind: String(values.get('kind') ?? 'computer'),
            ...(serial ? { serial } : {}),
            assignedMemberId: assignee || null,
          });
        }}
      >
        <label>
          Empresa
          <select
            required
            value={companyId}
            onChange={event => {
              setCompanyId(event.target.value);
              setAssignee('');
            }}
            disabled={busy}
          >
            <option value="" disabled>
              {companies.length ? 'Selecciona la empresa' : 'Primero crea una empresa'}
            </option>
            {companies.map(company => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          ID del equipo
          <input
            name="assetTag"
            required
            maxLength={64}
            placeholder="Ej.: NB-0042"
            autoComplete="off"
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
        <label>
          N° de serie (opcional)
          <input name="serial" maxLength={120} autoComplete="off" disabled={busy} />
        </label>
        <label>
          Asignar a
          <select value={assignee} onChange={event => setAssignee(event.target.value)} disabled={busy || !companyId}>
            <option value="">Sin asignar</option>
            {clients.map(client => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-footer">
          <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
            Cancelar
          </button>
          <button className="primary" disabled={busy || !companyId}>
            <Plus size={16} />
            Registrar equipo
          </button>
        </div>
      </form>
    </section>
  );
}
