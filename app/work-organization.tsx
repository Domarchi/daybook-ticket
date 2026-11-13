'use client';
import { readDaybookJson } from '@/lib/browser-json';
import { domainResponseValidator } from '@/lib/domain-response';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Archive, Check, ClipboardList, Filter, LoaderCircle, Plus, RefreshCw, Save, Tag, X } from 'lucide-react';
import type { CustomerCompany, Member } from '@/lib/types';
import type {
  CatalogItem,
  CatalogKind,
  FieldDefinition,
  FieldSnapshot,
  FieldValues,
  FormDefinition,
  OrganizationCatalog,
  SavedTicketView,
  TicketOrganization,
  TicketTask,
} from '@/lib/work-organization-model';
import { selectCompanyForm } from '@/lib/work-organization-model';
import { getDraftOperations } from '@/lib/draft-operations';
import type { TicketFilters } from '@/hooks/use-ticket-search';
import { daybookFetch } from '@/lib/browser-request';
import { ConfirmDialog } from './desk-parts/shared';
import './work-organization.css';

const EMPTY_CATALOG: OrganizationCatalog = { tags: [], requestTypes: [], fields: [], forms: [] };
const KIND_LABELS: Record<CatalogKind, string> = {
  tag: 'Etiquetas',
  requestType: 'Tipos de solicitud',
  field: 'Campos',
  form: 'Formularios',
};
export async function orgRequest<T>(
  memberId: string,
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await daybookFetch(
    path,
    {
      method,
      signal,
      cache: 'no-store',
      headers: {
        'X-Daybook-Member-Id': memberId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    method === 'GET'
      ? 'No se pudo conectar con Daybook. Vuelve a intentarlo.'
      : 'El cambio no se ha confirmado. Actualiza la vista para comprobar si se guardó antes de repetirlo.',
  );
  return readDaybookJson(response, { mutation: method !== 'GET', validate: domainResponseValidator<T>(path, method) });
}
export function useOrgResource<T>(memberId: string, path: string, enabled = true, refreshKey?: string | number) {
  const key = `${memberId}:${path}`,
    [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; data: T | null; error: string; loading: boolean }>({
    key: '',
    data: null,
    error: '',
    loading: false,
  });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState(old => ({ key, data: old.key === key ? old.data : null, error: '', loading: true }));
      try {
        const data = await orgRequest<T>(memberId, path, 'GET', undefined, controller.signal);
        if (!controller.signal.aborted) setState({ key, data, error: '', loading: false });
      } catch (reason) {
        if (!controller.signal.aborted)
          setState(old => ({
            key,
            data: old.key === key ? old.data : null,
            error: reason instanceof Error ? reason.message : 'No se pudo cargar.',
            loading: false,
          }));
      }
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [memberId, path, key, enabled, revision, refreshKey]);
  return {
    data: state.key === key ? state.data : null,
    error: state.key === key ? state.error : '',
    loading: enabled && (state.key !== key || state.loading),
    reload: () => setRevision(v => v + 1),
  };
}
function Feedback({ error, loading }: { error?: string; loading?: boolean }) {
  return (
    <>
      {error && (
        <p className="organization-error" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className="organization-loading" role="status">
          <LoaderCircle size={14} className="spin" />
          Actualizando…
        </p>
      )}
    </>
  );
}
export type OrganizationRequestValue = { requestTypeId?: string | null; fieldValues?: FieldValues };
export function OrganizationValueFields({
  fields,
  values,
  onChange,
  disabled = false,
}: {
  fields: FieldSnapshot[];
  values: FieldValues;
  onChange: (values: FieldValues) => void;
  disabled?: boolean;
}) {
  return (
    <div className="organization-fields">
      {fields.map(field => (
        <label key={`${field.id}:${field.version}`}>
          <span>
            {field.name}
            {field.required ? ' *' : ''}
            {field.visibility === 'internal' && <small>Solo equipo</small>}
          </span>
          {field.type === 'boolean' ? (
            <select
              required={field.required}
              disabled={disabled}
              value={values[field.id] === true ? 'true' : values[field.id] === false ? 'false' : ''}
              onChange={e =>
                onChange({ ...values, [field.id]: e.target.value === '' ? null : e.target.value === 'true' })
              }
            >
              <option value="">Seleccionar…</option>
              <option value="true">Sí</option>
              <option value="false">No</option>
            </select>
          ) : field.type === 'select' ? (
            <select
              required={field.required}
              disabled={disabled}
              value={String(values[field.id] ?? '')}
              onChange={e => onChange({ ...values, [field.id]: e.target.value })}
            >
              <option value="">Seleccionar…</option>
              {field.options.map(option => (
                <option key={option}>{option}</option>
              ))}
            </select>
          ) : field.type === 'textarea' ? (
            <textarea
              required={field.required}
              maxLength={4000}
              disabled={disabled}
              rows={3}
              value={String(values[field.id] ?? '')}
              onChange={e => onChange({ ...values, [field.id]: e.target.value })}
            />
          ) : (
            <input
              type={field.type === 'date' ? 'date' : 'text'}
              required={field.required}
              maxLength={500}
              disabled={disabled}
              value={String(values[field.id] ?? '')}
              onChange={e => onChange({ ...values, [field.id]: e.target.value })}
            />
          )}
        </label>
      ))}
    </div>
  );
}
export function RequestOrganizationFields({
  memberId,
  companyId = null,
  staff = false,
  value,
  onChange,
  disabled = false,
}: {
  memberId: string;
  companyId?: string | null;
  staff?: boolean;
  value: OrganizationRequestValue;
  onChange: (value: OrganizationRequestValue) => void;
  disabled?: boolean;
}) {
  const resource = useOrgResource<{ catalog: OrganizationCatalog }>(
      memberId,
      `/api/organization/catalog${companyId ? `?customerCompanyId=${encodeURIComponent(companyId)}` : ''}`,
    ),
    catalog = resource.data?.catalog ?? EMPTY_CATALOG;
  const form = value.requestTypeId
    ? selectCompanyForm(catalog.forms, value.requestTypeId, companyId, staff)
    : undefined;
  const fields = form?.definition.fields.filter(field => staff || field.visibility === 'public') ?? [];
  if (!resource.loading && !resource.error && !catalog.requestTypes.length) return null;
  return (
    <fieldset className="organization-request" disabled={disabled}>
      <legend>Detalles de la solicitud</legend>
      <Feedback error={resource.error} loading={resource.loading} />
      {resource.error && (
        <button type="button" className="text-button" onClick={resource.reload}>
          Volver a cargar los tipos
        </button>
      )}
      <label>
        Tipo de solicitud
        <select
          value={value.requestTypeId ?? ''}
          disabled={disabled || resource.loading}
          onChange={event => onChange({ requestTypeId: event.target.value || null, fieldValues: {} })}
        >
          <option value="">Solicitud general</option>
          {catalog.requestTypes
            .filter(type => !type.archived)
            .map(type => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
        </select>
      </label>
      {form && (
        <small className="organization-help">
          {form.name} · versión {form.version + 1}
        </small>
      )}
      <OrganizationValueFields
        fields={fields}
        values={value.fieldValues ?? {}}
        disabled={disabled}
        onChange={fieldValues => onChange({ ...value, fieldValues })}
      />
    </fieldset>
  );
}

export function OrganizationManager({ memberId, companies }: { memberId: string; companies: CustomerCompany[] }) {
  const [kind, setKind] = useState<CatalogKind>('tag'),
    [query, setQuery] = useState(''),
    [archived, setArchived] = useState(false),
    [cursor, setCursor] = useState<string | null>(null),
    [previous, setPrevious] = useState<(string | null)[]>([]);
  const path = `/api/organization/catalog?kind=${kind}&q=${encodeURIComponent(query)}&includeArchived=${archived}&limit=25${cursor ? `&cursor=${cursor}` : ''}`;
  const resource = useOrgResource<{
    catalog: OrganizationCatalog;
    items: CatalogItem[];
    nextCursor: string | null;
    total: number;
  }>(memberId, path);
  const [editing, setEditing] = useState<CatalogItem | 'new' | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const saving = useRef(false);
  const mutate = async (method: string, input: unknown) => {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await orgRequest(memberId, '/api/organization/catalog', method, input);
      resource.reload();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar.');
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="panel organization-panel">
      <div className="section-head">
        <h2>
          <ClipboardList size={18} />
          Organización de solicitudes
        </h2>
        <div className="organization-actions">
          <button
            type="button"
            className="secondary"
            aria-label="Actualizar catálogo"
            disabled={busy || resource.loading}
            onClick={resource.reload}
          >
            <RefreshCw size={15} />
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => setEditing('new')}>
            <Plus size={15} />
            Crear
          </button>
        </div>
      </div>
      <p className="organization-help">
        Los formularios conservan su versión. Los campos nuevos son internos hasta que un administrador los publique.
      </p>
      <div className="organization-tabs">
        {Object.entries(KIND_LABELS).map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={kind === id ? 'active' : ''}
            aria-pressed={kind === id}
            disabled={busy}
            onClick={() => {
              setKind(id as CatalogKind);
              setCursor(null);
              setPrevious([]);
              setEditing(null);
              setQuery('');
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="organization-filters">
        <label>
          <span className="sr-only">Buscar en el catálogo</span>
          <input
            type="search"
            placeholder={`Buscar ${KIND_LABELS[kind].toLowerCase()}…`}
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setCursor(null);
              setPrevious([]);
            }}
            maxLength={100}
          />
        </label>
        <label className="organization-check">
          <input
            type="checkbox"
            checked={archived}
            onChange={e => {
              setArchived(e.target.checked);
              setCursor(null);
              setPrevious([]);
            }}
          />
          Incluir archivadas
        </label>
      </div>
      <Feedback error={error || resource.error} loading={resource.loading} />
      {editing && (
        <CatalogEditor
          key={editing === 'new' ? `${kind}:new` : editing.id}
          kind={kind}
          item={editing === 'new' ? undefined : editing}
          catalog={resource.data?.catalog ?? EMPTY_CATALOG}
          companies={companies}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={async definition => {
            if (
              await mutate(
                editing === 'new' ? 'POST' : 'PATCH',
                editing === 'new'
                  ? { kind, definition }
                  : { id: editing.id, expectedVersion: editing.version, definition },
              )
            )
              setEditing(null);
          }}
        />
      )}
      <ul className="organization-catalog">
        {resource.data?.items.map(entry => (
          <li key={entry.id}>
            <div>
              <strong>{entry.name}</strong>
              <small>
                Versión {entry.version + 1}
                {entry.archived ? ' · Archivada' : ''}
                {entry.kind === 'field'
                  ? ` · ${(entry.definition as unknown as FieldDefinition).visibility === 'public' ? 'Campo público' : 'Solo equipo'}`
                  : ''}
                {entry.kind === 'form'
                  ? ` · ${(entry.definition as unknown as FormDefinition).published ? 'Publicado' : 'Borrador'}`
                  : ''}
              </small>
            </div>
            <div className="organization-actions">
              <button className="text-button" type="button" disabled={busy} onClick={() => setEditing(entry)}>
                Editar
              </button>
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() =>
                  void mutate('PATCH', { id: entry.id, expectedVersion: entry.version, archived: !entry.archived })
                }
              >
                <Archive size={14} />
                {entry.archived ? 'Restaurar' : 'Archivar'}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!resource.loading && resource.data?.items.length === 0 && (
        <p className="organization-help">No hay entradas para esta vista.</p>
      )}
      <div className="organization-pagination">
        <span>{resource.data?.total ?? 0} entradas</span>
        <button
          type="button"
          className="secondary"
          disabled={!previous.length || resource.loading}
          onClick={() => {
            setCursor(previous.at(-1) ?? null);
            setPrevious(v => v.slice(0, -1));
          }}
        >
          Anterior
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!resource.data?.nextCursor || resource.loading}
          onClick={() => {
            setPrevious(v => [...v, cursor]);
            setCursor(resource.data!.nextCursor);
          }}
        >
          Siguiente
        </button>
      </div>
    </section>
  );
}
function CatalogEditor({
  kind,
  item,
  catalog,
  companies,
  busy,
  onCancel,
  onSave,
}: {
  kind: CatalogKind;
  item?: CatalogItem;
  catalog: OrganizationCatalog;
  companies: CustomerCompany[];
  busy: boolean;
  onCancel: () => void;
  onSave: (definition: unknown) => Promise<void>;
}) {
  const old = item?.definition;
  const [name, setName] = useState(item?.name ?? ''),
    [description, setDescription] = useState(String(old?.description ?? '')),
    [color, setColor] = useState(String(old?.color ?? 'gold')),
    [type, setType] = useState(String(old?.type ?? 'text')),
    [required, setRequired] = useState(Boolean(old?.required)),
    [visibility, setVisibility] = useState(String(old?.visibility ?? 'internal')),
    [options, setOptions] = useState(Array.isArray(old?.options) ? old.options.join('\n') : ''),
    [companyId, setCompanyId] = useState(String(old?.customerCompanyId ?? '')),
    [requestTypeId, setRequestTypeId] = useState(String(old?.requestTypeId ?? '')),
    [published, setPublished] = useState(Boolean(old?.published)),
    [fieldIds, setFieldIds] = useState<string[]>(
      Array.isArray(old?.fieldIds)
        ? old.fieldIds.filter(id => catalog.fields.some(field => field.id === id && !field.archived))
        : [],
    );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSave(
      kind === 'tag'
        ? { name, color }
        : kind === 'requestType'
          ? { name, description }
          : kind === 'field'
            ? {
                name,
                type,
                required,
                visibility,
                options:
                  type === 'select'
                    ? options
                        .split('\n')
                        .map(v => v.trim())
                        .filter(Boolean)
                    : [],
              }
            : { name, customerCompanyId: companyId || null, requestTypeId, fieldIds, published },
    );
  };
  return (
    <form className="organization-editor" onSubmit={submit}>
      <h3>
        {item ? 'Editar' : 'Crear'} {KIND_LABELS[kind].toLowerCase()}
      </h3>
      <label>
        Nombre
        <input
          required
          maxLength={100}
          value={name}
          disabled={busy}
          onChange={e => setName(e.target.value)}
          autoFocus
        />
      </label>
      {kind === 'tag' && (
        <label>
          Color
          <select value={color} onChange={e => setColor(e.target.value)} disabled={busy}>
            {[
              ['gold', 'Dorado'],
              ['blue', 'Azul'],
              ['green', 'Verde'],
              ['red', 'Rojo'],
              ['gray', 'Gris'],
            ].map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === 'requestType' && (
        <label>
          Descripción
          <textarea
            maxLength={1000}
            value={description}
            rows={3}
            disabled={busy}
            onChange={e => setDescription(e.target.value)}
          />
        </label>
      )}
      {kind === 'field' && (
        <>
          <label>
            Formato
            <select value={type} disabled={busy} onChange={e => setType(e.target.value)}>
              {[
                ['text', 'Texto corto'],
                ['textarea', 'Texto largo'],
                ['select', 'Selección'],
                ['date', 'Fecha'],
                ['boolean', 'Sí/no'],
              ].map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Visibilidad
            <select value={visibility} disabled={busy} onChange={e => setVisibility(e.target.value)}>
              <option value="internal">Solo equipo</option>
              <option value="public">Disponible para formularios de cliente</option>
            </select>
          </label>
          <label className="organization-check">
            <input type="checkbox" checked={required} disabled={busy} onChange={e => setRequired(e.target.checked)} />
            Obligatorio al usar el formulario
          </label>
          {type === 'select' && (
            <label>
              Opciones, una por línea
              <textarea required rows={4} disabled={busy} value={options} onChange={e => setOptions(e.target.value)} />
              <small>Hasta 20 opciones de 100 caracteres.</small>
            </label>
          )}
          <p className="organization-help">
            El cambio crea una versión nueva. Los formularios existentes conservarán sus campos hasta que los edites y
            guardes otra vez.
          </p>
        </>
      )}
      {kind === 'form' && (
        <>
          <label>
            Empresa
            <select value={companyId} disabled={busy} onChange={e => setCompanyId(e.target.value)}>
              <option value="">Todas las empresas</option>
              {companies.map(company => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tipo de solicitud
            <select required value={requestTypeId} disabled={busy} onChange={e => setRequestTypeId(e.target.value)}>
              <option value="">Seleccionar…</option>
              {catalog.requestTypes
                .filter(t => !t.archived)
                .map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
          <fieldset>
            <legend>Campos del formulario</legend>
            {catalog.fields
              .filter(f => !f.archived)
              .map(field => (
                <label className="organization-check" key={field.id}>
                  <input
                    type="checkbox"
                    checked={fieldIds.includes(field.id)}
                    disabled={busy || (!fieldIds.includes(field.id) && fieldIds.length >= 20)}
                    onChange={e =>
                      setFieldIds(ids => (e.target.checked ? [...ids, field.id] : ids.filter(id => id !== field.id)))
                    }
                  />
                  {field.name}
                  <small>
                    {(field.definition as unknown as FieldDefinition).visibility === 'internal'
                      ? 'Solo equipo'
                      : 'Público'}{' '}
                    · v{field.version + 1}
                  </small>
                </label>
              ))}
          </fieldset>
          <label className="organization-check">
            <input type="checkbox" checked={published} disabled={busy} onChange={e => setPublished(e.target.checked)} />
            Publicar para los clientes de la empresa seleccionada
          </label>
          <p className="organization-help">
            Solo se mostrarán al cliente los campos marcados como públicos. Guardar toma las versiones actuales de los
            campos activos.
          </p>
        </>
      )}
      <div className="organization-actions">
        <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button className="primary" disabled={busy || !name.trim()}>
          <Save size={15} />
          Guardar
        </button>
      </div>
    </form>
  );
}

export function TicketOrganizationPanel({
  ticketId,
  memberId,
  staff,
  members,
  onChanged,
  refreshKey,
}: {
  ticketId: number;
  memberId: string;
  staff: boolean;
  members: Member[];
  onChanged?: () => void;
  refreshKey?: string | number;
}) {
  const resource = useOrgResource<{ organization: TicketOrganization & { customerCompanyId: string | null } }>(
    memberId,
    `/api/tickets/${ticketId}/organization`,
    true,
    refreshKey,
  );
  const catalogs = useOrgResource<{ catalog: OrganizationCatalog }>(memberId, '/api/organization/catalog', staff);
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const saving = useRef(false);
  const [draft, setDraft] = useState<{
    tagIds: string[];
    requestTypeId: string | null;
    fieldValues: FieldValues;
    waitReason: string;
  }>({ tagIds: [], requestTypeId: null, fieldValues: {}, waitReason: '' });
  const org = resource.data?.organization,
    catalog = catalogs.data?.catalog ?? EMPTY_CATALOG;
  const newType = draft.requestTypeId !== org?.requestType?.id,
    form = draft.requestTypeId
      ? selectCompanyForm(catalog.forms, draft.requestTypeId, org?.customerCompanyId ?? null, true)
      : undefined;
  const fields = newType
    ? (form?.definition.fields ?? [])
    : Object.values(org?.values ?? {}).map(item => item.definition);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!org || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await orgRequest(memberId, `/api/tickets/${ticketId}/organization`, 'PATCH', {
        ...draft,
        expectedVersion: org.version,
      });
      setEditing(false);
      resource.reload();
      onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const begin = () => {
    if (!org) return;
    setDraft({
      tagIds: org.tags.map(v => v.id),
      requestTypeId: org.requestType?.id ?? null,
      fieldValues: Object.fromEntries(Object.entries(org.values).map(([id, v]) => [id, v.value])),
      waitReason: org.waitReason ?? '',
    });
    setError('');
    setEditing(true);
  };
  const hasPublic = Boolean(org?.requestType || Object.keys(org?.values ?? {}).length);
  return (
    <>
      {(staff || hasPublic || resource.loading || resource.error) && (
        <section className="panel organization-panel">
          <div className="section-head">
            <h2>
              <Tag size={17} />
              {staff ? 'Organización del ticket' : 'Detalles de la solicitud'}
            </h2>
            {staff && (
              <button className="secondary" type="button" disabled={!org || busy} onClick={begin}>
                Editar
              </button>
            )}
          </div>
          <Feedback error={error || resource.error} loading={resource.loading} />
          {editing && org ? (
            <form className="organization-editor" onSubmit={save}>
              <label>
                Tipo de solicitud
                <select
                  value={draft.requestTypeId ?? ''}
                  disabled={busy}
                  onChange={e => setDraft({ ...draft, requestTypeId: e.target.value || null, fieldValues: {} })}
                >
                  <option value="">Solicitud general</option>
                  {org.requestType && !catalog.requestTypes.some(t => t.id === org.requestType?.id) && (
                    <option value={org.requestType.id}>{org.requestType.name} · histórica</option>
                  )}
                  {catalog.requestTypes
                    .filter(v => !v.archived)
                    .map(v => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                </select>
              </label>
              <fieldset>
                <legend>Etiquetas</legend>
                {[...catalog.tags, ...org.tags.filter(v => !catalog.tags.some(tag => tag.id === v.id))].map(tag => (
                  <label className="organization-check" key={tag.id}>
                    <input
                      type="checkbox"
                      disabled={busy || (!draft.tagIds.includes(tag.id) && draft.tagIds.length >= 20)}
                      checked={draft.tagIds.includes(tag.id)}
                      onChange={e =>
                        setDraft({
                          ...draft,
                          tagIds: e.target.checked
                            ? [...draft.tagIds, tag.id]
                            : draft.tagIds.filter(id => id !== tag.id),
                        })
                      }
                    />
                    {tag.name}
                    {tag.archived ? ' · archivada' : ''}
                  </label>
                ))}
              </fieldset>
              <OrganizationValueFields
                fields={fields}
                values={draft.fieldValues}
                disabled={busy}
                onChange={fieldValues => setDraft({ ...draft, fieldValues })}
              />
              <label>
                Motivo de espera interno
                <textarea
                  maxLength={500}
                  rows={2}
                  value={draft.waitReason}
                  disabled={busy}
                  onChange={e => setDraft({ ...draft, waitReason: e.target.value })}
                />
                <small>Informativo para el equipo. No pausa ni modifica el SLA.</small>
              </label>
              <div className="organization-actions">
                <button className="secondary" type="button" disabled={busy} onClick={() => setEditing(false)}>
                  Cancelar
                </button>
                <button className="primary" disabled={busy}>
                  Guardar organización
                </button>
              </div>
            </form>
          ) : (
            org && (
              <div className="organization-summary">
                <div className="organization-tags">
                  {org.tags.map(tag => (
                    <span className={`organization-tag ${String(tag.definition.color)}`} key={tag.id}>
                      {tag.name}
                      {tag.archived ? ' · archivada' : ''}
                    </span>
                  ))}
                </div>
                {org.requestType && (
                  <p>
                    <strong>Tipo:</strong> {org.requestType.name}
                  </p>
                )}
                {Object.entries(org.values).map(([id, entry]) => (
                  <dl key={id}>
                    <dt>
                      {entry.definition.name}
                      {entry.definition.visibility === 'internal' ? ' · Solo equipo' : ''}
                    </dt>
                    <dd>
                      {entry.value === null
                        ? 'Sin completar'
                        : typeof entry.value === 'boolean'
                          ? entry.value
                            ? 'Sí'
                            : 'No'
                          : entry.value}
                    </dd>
                  </dl>
                ))}
                {staff && org.waitReason && (
                  <p>
                    <strong>Motivo de espera:</strong> {org.waitReason}
                  </p>
                )}
                {staff && !org.requestType && !org.tags.length && !org.waitReason && (
                  <p className="organization-help">Agrega etiquetas, un tipo de solicitud o contexto interno.</p>
                )}
              </div>
            )
          )}
        </section>
      )}
      {staff && (
        <TicketTasksPanel
          ticketId={ticketId}
          memberId={memberId}
          members={members}
          onChanged={onChanged}
          refreshKey={refreshKey}
        />
      )}
    </>
  );
}
function localTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function TicketTasksPanel({
  ticketId,
  memberId,
  members,
  onChanged,
  refreshKey,
}: {
  ticketId: number;
  memberId: string;
  members: Member[];
  onChanged?: () => void;
  refreshKey?: string | number;
}) {
  const [cursor, setCursor] = useState<string | null>(null),
    [previous, setPrevious] = useState<(string | null)[]>([]);
  const resource = useOrgResource<{ items: TicketTask[]; nextCursor: string | null }>(
    memberId,
    `/api/tickets/${ticketId}/tasks?limit=25${cursor ? `&cursor=${cursor}` : ''}`,
    true,
    refreshKey,
  );
  const [editing, setEditing] = useState<TicketTask | 'new' | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const saving = useRef(false);
  const save = async (
    input: { title: string; assigneeMemberId: string | null; dueAt: string | null; status?: TicketTask['status'] },
    task?: TicketTask,
  ) => {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    setError('');
    const scope = `organization-task:${memberId}:${ticketId}`,
      operations = getDraftOperations();
    try {
      await orgRequest(
        memberId,
        task ? `/api/ticket-tasks/${task.id}` : `/api/tickets/${ticketId}/tasks`,
        task ? 'PATCH' : 'POST',
        task
          ? { ...input, expectedVersion: task.version }
          : { ...input, operationId: operations.forPayload(scope, input) },
      );
      if (!task) operations.clear(scope);
      resource.reload();
      onChanged?.();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar la tarea.');
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="panel organization-panel">
      <div className="section-head">
        <h2>
          <ClipboardList size={17} />
          Tareas internas
        </h2>
        <button className="secondary" type="button" disabled={busy} onClick={() => setEditing('new')}>
          <Plus size={15} />
          Tarea
        </button>
      </div>
      <p className="organization-help">Solo el equipo. Las tareas no bloquean resolver el ticket.</p>
      <Feedback error={error || resource.error} loading={resource.loading} />
      {editing && (
        <TaskEditor
          key={editing === 'new' ? 'new' : editing.id}
          task={editing === 'new' ? undefined : editing}
          members={members}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={async input => {
            if (await save(input, editing === 'new' ? undefined : editing)) setEditing(null);
          }}
        />
      )}
      <ul className="organization-tasks">
        {resource.data?.items.map(task => (
          <li key={task.id}>
            <button
              className="organization-task-toggle"
              type="button"
              disabled={busy || task.status === 'cancelled'}
              aria-label={`${task.status === 'done' ? 'Reabrir' : 'Completar'} tarea ${task.title}`}
              onClick={() =>
                void save(
                  {
                    title: task.title,
                    assigneeMemberId: task.assigneeMemberId,
                    dueAt: task.dueAt,
                    status: task.status === 'done' ? 'open' : 'done',
                  },
                  task,
                )
              }
            >
              {task.status === 'done' ? <Check size={16} /> : task.status === 'cancelled' ? <X size={16} /> : <span />}
            </button>
            <div>
              <strong className={task.status === 'done' ? 'is-done' : ''}>{task.title}</strong>
              <small>
                {task.assigneeName ?? 'Sin responsable'} ·{' '}
                {task.status === 'done' ? 'Completada' : task.status === 'cancelled' ? 'Cancelada' : 'Pendiente'}
                {task.dueAt
                  ? ` · ${new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date(task.dueAt))}`
                  : ''}
              </small>
            </div>
            <button type="button" className="text-button" disabled={busy} onClick={() => setEditing(task)}>
              Editar
            </button>
          </li>
        ))}
      </ul>
      {!resource.loading && !resource.data?.items.length && (
        <p className="organization-help">Todavía no hay tareas internas.</p>
      )}
      <div className="organization-pagination">
        <button
          className="secondary"
          type="button"
          disabled={!previous.length || resource.loading}
          onClick={() => {
            setCursor(previous.at(-1) ?? null);
            setPrevious(v => v.slice(0, -1));
          }}
        >
          Anterior
        </button>
        <button
          className="secondary"
          type="button"
          disabled={!resource.data?.nextCursor || resource.loading}
          onClick={() => {
            setPrevious(v => [...v, cursor]);
            setCursor(resource.data!.nextCursor);
          }}
        >
          Siguiente
        </button>
      </div>
    </section>
  );
}
function TaskEditor({
  task,
  members,
  busy,
  onCancel,
  onSave,
}: {
  task?: TicketTask;
  members: Member[];
  busy: boolean;
  onCancel: () => void;
  onSave: (input: {
    title: string;
    assigneeMemberId: string | null;
    dueAt: string | null;
    status?: TicketTask['status'];
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState(task?.title ?? ''),
    [assignee, setAssignee] = useState(task?.assigneeMemberId ?? ''),
    [due, setDue] = useState(localTime(task?.dueAt ?? null)),
    [status, setStatus] = useState<TicketTask['status']>(task?.status ?? 'open');
  const active = members.filter(member => member.role !== 'client' && member.status === 'active' && member.hasAccount);
  return (
    <form
      className="organization-editor"
      onSubmit={e => {
        e.preventDefault();
        void onSave({
          title,
          assigneeMemberId: assignee || null,
          dueAt: due ? new Date(due).toISOString() : null,
          ...(task ? { status } : {}),
        });
      }}
    >
      <label>
        Tarea
        <input
          required
          maxLength={200}
          value={title}
          disabled={busy}
          onChange={e => setTitle(e.target.value)}
          autoFocus
        />
      </label>
      <label>
        Responsable
        <select value={assignee} disabled={busy} onChange={e => setAssignee(e.target.value)}>
          <option value="">Sin responsable</option>
          {assignee && !active.some(v => v.id === assignee) && (
            <option value={assignee} disabled>
              {task?.assigneeName ?? 'Responsable anterior'} · sin acceso activo
            </option>
          )}
          {active.map(member => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Fecha y hora de tu equipo
        <input type="datetime-local" value={due} disabled={busy} onChange={e => setDue(e.target.value)} />
      </label>
      {task && (
        <label>
          Estado
          <select value={status} disabled={busy} onChange={e => setStatus(e.target.value as TicketTask['status'])}>
            <option value="open">Pendiente</option>
            <option value="done">Completada</option>
            <option value="cancelled">Cancelada</option>
          </select>
        </label>
      )}
      <div className="organization-actions">
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
        <button className="primary" disabled={busy || !title.trim()}>
          Guardar tarea
        </button>
      </div>
    </form>
  );
}

export function SavedViewPicker({
  memberId,
  filters,
  onApply,
}: {
  memberId: string;
  filters: TicketFilters;
  onApply: (filters: TicketFilters) => void;
}) {
  const resource = useOrgResource<{ views: SavedTicketView[] }>(memberId, '/api/saved-views');
  const [selected, setSelected] = useState(''),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirmDelete, setConfirmDelete] = useState(false);
  const saving = useRef(false);
  const view = resource.data?.views.find(v => v.id === selected);
  const mutate = async (method: string, path: string, input: unknown) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await orgRequest(memberId, path, method, input);
      resource.reload();
      setConfirmDelete(false);
      if (method === 'POST' || method === 'DELETE') {
        setSelected('');
        setName('');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar la vista.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <details className="organization-saved-views">
      <summary>
        <Filter size={15} />
        Mis vistas guardadas
      </summary>
      <Feedback error={error || resource.error} loading={resource.loading} />
      <div className="organization-filters">
        <label>
          Vista
          <select
            value={selected}
            disabled={busy}
            onChange={e => {
              setSelected(e.target.value);
              setConfirmDelete(false);
              const v = resource.data?.views.find(item => item.id === e.target.value);
              setName(v?.name ?? '');
            }}
          >
            <option value="">Nueva vista</option>
            {resource.data?.views.map(v => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary"
          type="button"
          disabled={busy || !view}
          onClick={() => {
            if (view) onApply(view.filters);
          }}
        >
          Aplicar
        </button>
        <label>
          Nombre
          <input
            maxLength={100}
            value={name}
            disabled={busy}
            placeholder="Ej. Mis tickets urgentes"
            onChange={e => setName(e.target.value)}
          />
        </label>
        <button
          className="secondary"
          type="button"
          disabled={busy || !name.trim()}
          onClick={() =>
            void mutate(view ? 'PATCH' : 'POST', view ? `/api/saved-views/${view.id}` : '/api/saved-views', {
              name,
              filters,
              ...(view ? { expectedVersion: view.version } : {}),
            })
          }
        >
          <Save size={14} />
          {view ? 'Actualizar con filtros actuales' : 'Guardar filtros actuales'}
        </button>
        {view && (
          <button className="text-button" type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>
            Eliminar vista
          </button>
        )}
        {view && confirmDelete && (
          <ConfirmDialog
            title="Eliminar vista personal"
            description={`La vista «${view.name}» se borra de tu cuenta. Los tickets no cambian. No se puede deshacer.`}
            confirmLabel="Eliminar vista"
            busy={busy}
            onClose={() => setConfirmDelete(false)}
            onConfirm={async () => {
              // Se cierra también si falla, para que el error se lea fuera del diálogo.
              await mutate('DELETE', `/api/saved-views/${view.id}`, { expectedVersion: view.version });
              setConfirmDelete(false);
            }}
          />
        )}
      </div>
      <p className="organization-help">
        Las vistas se guardan solo en tu cuenta. Los permisos se comprueban nuevamente al aplicarlas.
      </p>
    </details>
  );
}
