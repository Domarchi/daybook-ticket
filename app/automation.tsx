'use client';
import { currentWorkspaceId } from '@/lib/workspace-client';
import { statusLabelCoarse } from '@/lib/ticket-status';
import { workspaceHome } from '@/lib/workspace-model';
import { useRef, useState, type FormEvent } from 'react';
import {
  Archive,
  ArrowUpRight,
  ClipboardList,
  FlaskConical,
  Link as LinkIcon,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  X,
} from 'lucide-react';
import type { CustomerCompany, Member } from '@/lib/types';
import {
  automationRuleSchema,
  automationEventKinds,
  type AutomationEventKind,
  type AutomationRule,
  type AutomationRuleDefinition,
  type AutomationPlan,
  type TaskTemplate,
  type TicketRelation,
} from '@/lib/automation-model';
import type { OrganizationCatalog } from '@/lib/work-organization-model';
import { getDraftOperations } from '@/lib/draft-operations';
import { orgRequest, useOrgResource } from './work-organization';
import './automation.css';
type Page<T> = { items: T[]; nextCursor: string | null };
type SettingsResult = {
  settings: { enabled: boolean; version: number; activatedAt: string | null };
  health: {
    lastStartedAt: string | null;
    lastSucceededAt: string | null;
    lastFailedAt: string | null;
    lastErrorCode: string | null;
    processedEvents: number;
  } | null;
  counts: { queued: number; failed: number };
  jobConfigured: boolean;
};
type Execution = {
  id: string;
  ticketId: number;
  ruleName: string;
  status: 'applied' | 'skipped' | 'failed';
  attempts: number;
  summary: { summary?: string[]; reason?: string };
  createdAt: string;
};
const EMPTY_CATALOG: OrganizationCatalog = { tags: [], requestTypes: [], fields: [], forms: [] };
const EVENT_LABELS: Record<AutomationEventKind, string> = {
  ticket_created: 'Ticket creado',
  ticket_updated: 'Ticket actualizado',
  client_replied: 'Respuesta del cliente',
  agent_replied: 'Respuesta del equipo',
};
const definition = (rule: AutomationRule): AutomationRuleDefinition => ({
  name: rule.name,
  enabled: rule.enabled,
  position: rule.position,
  conditions: rule.conditions,
  actions: rule.actions,
});
const emptyRule = (): AutomationRuleDefinition => ({
  name: '',
  enabled: false,
  position: 0,
  conditions: {
    events: ['ticket_created'],
    customerCompanyId: null,
    departments: [],
    priorities: [],
    statuses: ['open', 'pending'],
    requestTypeIds: [],
    allTagIds: [],
  },
  actions: { addTagIds: [], department: null, assignMemberIds: [], taskTemplateIds: [] },
});
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Santiago' }).format(
        new Date(value),
      )
    : 'Sin ejecuciones';
function ErrorText({ children }: { children: string }) {
  return children ? (
    <p className="automation-error" role="alert">
      {children}
    </p>
  ) : null;
}
function Pager({
  nextCursor,
  loading,
  next,
  previous,
  canPrevious,
}: {
  nextCursor: string | null;
  loading: boolean;
  next: () => void;
  previous: () => void;
  canPrevious: boolean;
}) {
  return (
    <div className="automation-pagination">
      <button className="secondary" type="button" disabled={loading || !canPrevious} onClick={previous}>
        Anterior
      </button>
      <button className="secondary" type="button" disabled={loading || !nextCursor} onClick={next}>
        Siguiente
      </button>
    </div>
  );
}
function Checks({
  legend,
  items,
  selected,
  onChange,
  disabled = false,
  max = 20,
}: {
  legend: string;
  items: { id: string; name: string; inactive?: boolean }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  max?: number;
}) {
  return (
    <fieldset className="automation-checks">
      <legend>{legend}</legend>
      {!items.length && <small>Sin opciones disponibles.</small>}
      {[
        ...items,
        ...selected
          .filter(id => !items.some(item => item.id === id))
          .map(id => ({ id, name: 'Referencia anterior no disponible', inactive: true })),
      ].map(item => (
        <label key={item.id}>
          <input
            type="checkbox"
            checked={selected.includes(item.id)}
            disabled={disabled || (!selected.includes(item.id) && (selected.length >= max || item.inactive))}
            onChange={e => onChange(e.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))}
          />
          <span>
            {item.name}
            {item.inactive ? ' · sin acceso activo' : ''}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function AutomationPanel({
  memberId,
  companies,
  members,
  departments,
}: {
  memberId: string;
  companies: CustomerCompany[];
  members: Member[];
  departments: string[];
}) {
  const [tab, setTab] = useState<'rules' | 'templates' | 'history'>('rules'),
    [archived, setArchived] = useState(false),
    [cursor, setCursor] = useState<string | null>(null),
    [previous, setPrevious] = useState<(string | null)[]>([]);
  const settings = useOrgResource<SettingsResult>(memberId, '/api/automation/settings');
  const rules = useOrgResource<Page<AutomationRule>>(
    memberId,
    `/api/automation/rules?limit=25&includeArchived=${archived}${cursor ? `&cursor=${cursor}` : ''}`,
    tab === 'rules',
  );
  const templates = useOrgResource<Page<TaskTemplate> & { activeTemplates: TaskTemplate[] }>(
    memberId,
    `/api/task-templates?limit=25&includeArchived=${archived}${tab === 'templates' && cursor ? `&cursor=${cursor}` : ''}`,
  );
  const history = useOrgResource<Page<Execution>>(
    memberId,
    `/api/automation/executions?limit=25${cursor ? `&cursor=${cursor}` : ''}`,
    tab === 'history',
  );
  const catalogs = useOrgResource<{ catalog: OrganizationCatalog }>(memberId, '/api/organization/catalog');
  const [historyRuleId, setHistoryRuleId] = useState<string | null>(null);
  const [ruleEditor, setRuleEditor] = useState<AutomationRule | 'new' | null>(null),
    [templateEditor, setTemplateEditor] = useState<TaskTemplate | 'new' | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const saving = useRef(false);
  const reload = () => {
    settings.reload();
    rules.reload();
    templates.reload();
    history.reload();
    catalogs.reload();
  };
  const mutate = async (path: string, method: string, body: unknown) => {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await orgRequest(memberId, path, method, body);
      reload();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar.');
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const current = tab === 'rules' ? rules : tab === 'templates' ? templates : history;
  const staff = members.filter(member => member.role !== 'client');
  return (
    <div className="automation-page">
      <section className="panel automation-panel">
        <div className="section-head">
          <h2>
            <Settings2 size={18} />
            Automatizaciones internas
          </h2>
          <button className="secondary" type="button" disabled={busy} onClick={reload}>
            <RefreshCw size={15} />
            Actualizar
          </button>
        </div>
        <p className="automation-help">
          Se ejecuta la primera regla vigente que coincida con el evento, por orden y luego por identificador. Cada
          cambio se registra; las acciones no generan cadenas de reglas.
        </p>
        <div className="automation-settings">
          <label>
            <input
              type="checkbox"
              checked={settings.data?.settings.enabled ?? false}
              disabled={busy || !settings.data}
              onChange={e =>
                void mutate('/api/automation/settings', 'PATCH', {
                  enabled: e.target.checked,
                  expectedVersion: settings.data!.settings.version,
                })
              }
            />
            Activar el motor para eventos nuevos
          </label>
          <small>
            Las reglas y el programador empiezan desactivados. Al reactivar no se procesan eventos anteriores a esa
            activación.
          </small>
          <dl>
            <div>
              <dt>Pendientes</dt>
              <dd>{settings.data?.counts.queued ?? '—'}</dd>
            </div>
            <div>
              <dt>Con error</dt>
              <dd>{settings.data?.counts.failed ?? '—'}</dd>
            </div>
            <div>
              <dt>Última ejecución correcta</dt>
              <dd>{date(settings.data?.health?.lastSucceededAt ?? null)}</dd>
            </div>
          </dl>
          {settings.data && !settings.data.jobConfigured && (
            <p className="automation-help">
              El ejecutor programado está pendiente de configuración. La activación de infraestructura se revisa por
              separado.
            </p>
          )}
        </div>
        <div className="automation-tabs">
          {[
            ['rules', 'Reglas'],
            ['templates', 'Plantillas de tareas'],
            ['history', 'Historial'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={tab === value ? 'active' : ''}
              aria-pressed={tab === value}
              disabled={busy}
              onClick={() => {
                setTab(value as typeof tab);
                setCursor(null);
                setPrevious([]);
                setRuleEditor(null);
                setTemplateEditor(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <ErrorText>{error || settings.error || current.error || catalogs.error}</ErrorText>
        <div className="automation-actions">
          {tab !== 'history' && (
            <label className="automation-check">
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
          )}
          {tab === 'rules' && (
            <button className="secondary" type="button" disabled={busy} onClick={() => setRuleEditor('new')}>
              <Plus size={15} />
              Nueva regla
            </button>
          )}
          {tab === 'templates' && (
            <button className="secondary" type="button" disabled={busy} onClick={() => setTemplateEditor('new')}>
              <Plus size={15} />
              Nueva plantilla
            </button>
          )}
        </div>
        {current.loading && (
          <p className="automation-help" role="status">
            <LoaderCircle size={14} className="spin" />
            Actualizando…
          </p>
        )}
        {ruleEditor && (
          <AutomationRuleEditor
            key={ruleEditor === 'new' ? 'new' : ruleEditor.id}
            memberId={memberId}
            existing={ruleEditor === 'new' ? undefined : ruleEditor}
            companies={companies}
            members={staff}
            departments={departments}
            catalog={catalogs.data?.catalog ?? EMPTY_CATALOG}
            templates={templates.data?.activeTemplates ?? []}
            busy={busy}
            onCancel={() => setRuleEditor(null)}
            onSave={async (rule, proof) => {
              if (
                await mutate(
                  '/api/automation/rules',
                  ruleEditor === 'new' ? 'POST' : 'PATCH',
                  ruleEditor === 'new'
                    ? { rule, simulationProof: proof }
                    : { id: ruleEditor.id, expectedVersion: ruleEditor.version, rule, simulationProof: proof },
                )
              )
                setRuleEditor(null);
            }}
          />
        )}
        {templateEditor && (
          <TaskTemplateEditor
            key={templateEditor === 'new' ? 'new' : templateEditor.id}
            existing={templateEditor === 'new' ? undefined : templateEditor}
            members={staff}
            busy={busy}
            onCancel={() => setTemplateEditor(null)}
            onSave={async template => {
              if (
                await mutate(
                  '/api/task-templates',
                  templateEditor === 'new' ? 'POST' : 'PATCH',
                  templateEditor === 'new'
                    ? template
                    : { id: templateEditor.id, expectedVersion: templateEditor.version, template },
                )
              )
                setTemplateEditor(null);
            }}
          />
        )}
        {historyRuleId && (
          <AutomationRuleHistory
            key={historyRuleId}
            memberId={memberId}
            ruleId={historyRuleId}
            onClose={() => setHistoryRuleId(null)}
          />
        )}
        {tab === 'rules' && (
          <ul className="automation-list">
            {rules.data?.items.map(rule => (
              <li key={rule.id}>
                <div>
                  <strong>{rule.name}</strong>
                  <small>
                    Orden {rule.position} · v{rule.version + 1} ·{' '}
                    {rule.archived ? 'Archivada' : rule.enabled ? 'Habilitada' : 'Pausada'}
                  </small>
                </div>
                <div className="automation-actions">
                  <button className="text-button" type="button" onClick={() => setHistoryRuleId(rule.id)}>
                    Versiones
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    disabled={busy || rule.archived}
                    onClick={() => setRuleEditor(rule)}
                  >
                    Editar y simular
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void mutate('/api/automation/rules', 'PATCH', {
                        id: rule.id,
                        expectedVersion: rule.version,
                        archived: !rule.archived,
                      })
                    }
                  >
                    <Archive size={14} />
                    {rule.archived ? 'Restaurar pausada' : 'Archivar'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {tab === 'templates' && (
          <ul className="automation-list">
            {templates.data?.items.map(template => (
              <li key={template.id}>
                <div>
                  <strong>{template.name}</strong>
                  <small>
                    {template.items.length} tareas · v{template.version + 1}
                    {template.archived ? ' · Archivada' : ''}
                  </small>
                </div>
                <div className="automation-actions">
                  <button
                    className="text-button"
                    type="button"
                    disabled={busy || template.archived}
                    onClick={() => setTemplateEditor(template)}
                  >
                    Editar
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void mutate('/api/task-templates', 'PATCH', {
                        id: template.id,
                        expectedVersion: template.version,
                        archived: !template.archived,
                      })
                    }
                  >
                    <Archive size={14} />
                    {template.archived ? 'Restaurar' : 'Archivar'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {tab === 'history' && (
          <ul className="automation-list">
            {history.data?.items.map(entry => (
              <li key={entry.id}>
                <div>
                  <strong>{entry.ruleName}</strong>
                  <small>
                    <a href={workspaceHome(currentWorkspaceId(), entry.ticketId)}>Ticket #{entry.ticketId}</a> ·{' '}
                    {date(entry.createdAt)} · {entry.attempts} intentos
                  </small>
                  <p>{entry.summary.reason ?? entry.summary.summary?.join(' · ') ?? 'Sin cambios.'}</p>
                </div>
                <span className={`automation-state ${entry.status}`}>
                  {entry.status === 'applied' ? 'Aplicada' : entry.status === 'failed' ? 'Error' : 'Omitida'}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!current.loading && !current.data?.items.length && (
          <p className="automation-help">
            {tab === 'history' ? 'Las ejecuciones futuras aparecerán aquí.' : 'Todavía no hay entradas en esta vista.'}
          </p>
        )}
        <Pager
          nextCursor={current.data?.nextCursor ?? null}
          loading={current.loading}
          canPrevious={previous.length > 0}
          previous={() => {
            setCursor(previous.at(-1) ?? null);
            setPrevious(v => v.slice(0, -1));
          }}
          next={() => {
            setPrevious(v => [...v, cursor]);
            setCursor(current.data!.nextCursor);
          }}
        />
      </section>
    </div>
  );
}
function AutomationRuleEditor({
  memberId,
  existing,
  companies,
  members,
  departments,
  catalog,
  templates,
  busy,
  onCancel,
  onSave,
}: {
  memberId: string;
  existing?: AutomationRule;
  companies: CustomerCompany[];
  members: Member[];
  departments: string[];
  catalog: OrganizationCatalog;
  templates: TaskTemplate[];
  busy: boolean;
  onCancel: () => void;
  onSave: (rule: AutomationRuleDefinition, proof?: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<AutomationRuleDefinition>(() => (existing ? definition(existing) : emptyRule())),
    [ticketId, setTicketId] = useState(''),
    [sampleEvent, setSampleEvent] = useState<AutomationEventKind>('ticket_created'),
    [error, setError] = useState(''),
    [simulating, setSimulating] = useState(false),
    [preview, setPreview] = useState<{
      fingerprint: string;
      proof: string;
      plan: AutomationPlan;
      subject: string;
    } | null>(null);
  const simOperation = useRef(false);
  const fingerprint = JSON.stringify({ ...draft, enabled: false }),
    validProof = preview?.fingerprint === fingerprint;
  const conditions = (changes: Partial<AutomationRuleDefinition['conditions']>) =>
      setDraft({ ...draft, conditions: { ...draft.conditions, ...changes } }),
    actions = (changes: Partial<AutomationRuleDefinition['actions']>) =>
      setDraft({ ...draft, actions: { ...draft.actions, ...changes } });
  const simulate = async () => {
    if (simOperation.current) return;
    simOperation.current = true;
    setSimulating(true);
    setError('');
    try {
      const rule = automationRuleSchema.parse(draft);
      const result = await orgRequest<{ plan: AutomationPlan; simulationProof: string; ticket: { subject: string } }>(
        memberId,
        '/api/automation/simulate',
        'POST',
        { ticketId: Number(ticketId), eventKind: sampleEvent, rule },
      );
      setPreview({ fingerprint, proof: result.simulationProof, plan: result.plan, subject: result.ticket.subject });
    } catch (reason) {
      setPreview(null);
      setError(reason instanceof Error ? reason.message : 'No se pudo simular.');
    } finally {
      simOperation.current = false;
      setSimulating(false);
    }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      void onSave(automationRuleSchema.parse(draft), validProof ? preview!.proof : undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Revisa la regla.');
    }
  };
  const staffOptions = members.map(member => ({
    id: member.id,
    name: member.name,
    inactive: member.status !== 'active' || !member.hasAccount,
  }));
  return (
    <form className="automation-editor" onSubmit={save}>
      <h3>{existing ? 'Editar regla' : 'Nueva regla interna'}</h3>
      <ErrorText>{error}</ErrorText>
      <div className="automation-grid">
        <label>
          Nombre
          <input
            required
            maxLength={120}
            value={draft.name}
            disabled={busy || simulating}
            onChange={e => setDraft({ ...draft, name: e.target.value })}
            autoFocus
          />
        </label>
        <label>
          Orden
          <input
            type="number"
            required
            min={0}
            max={999}
            value={draft.position}
            disabled={busy || simulating}
            onChange={e => setDraft({ ...draft, position: Number(e.target.value) })}
          />
        </label>
        <label>
          Empresa
          <select
            value={draft.conditions.customerCompanyId ?? ''}
            disabled={busy || simulating}
            onChange={e => conditions({ customerCompanyId: e.target.value || null })}
          >
            <option value="">Todas las empresas</option>
            {companies.map(company => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Checks
        legend="Eventos"
        items={automationEventKinds.map(id => ({ id, name: EVENT_LABELS[id] }))}
        selected={draft.conditions.events}
        max={4}
        disabled={busy || simulating}
        onChange={ids => conditions({ events: ids as AutomationEventKind[] })}
      />
      <div className="automation-grid">
        <Checks
          legend="Estados · vacío significa cualquiera"
          items={[
            { id: 'open', name: 'Abierto (sin asignar o en proceso)' },
            { id: 'resolved', name: 'Solucionado' },
            { id: 'closed', name: 'Cerrado' },
          ]}
          selected={draft.conditions.statuses}
          max={4}
          disabled={busy || simulating}
          onChange={ids => conditions({ statuses: ids as AutomationRuleDefinition['conditions']['statuses'] })}
        />
        <Checks
          legend="Prioridades · vacío significa cualquiera"
          items={[
            { id: 'low', name: 'Baja' },
            { id: 'normal', name: 'Normal' },
            { id: 'high', name: 'Alta' },
            { id: 'urgent', name: 'Urgente' },
          ]}
          selected={draft.conditions.priorities}
          max={4}
          disabled={busy || simulating}
          onChange={ids => conditions({ priorities: ids as AutomationRuleDefinition['conditions']['priorities'] })}
        />
      </div>
      <details>
        <summary>Más condiciones</summary>
        <div className="automation-grid">
          <Checks
            legend="Departamentos · vacío significa cualquiera"
            items={departments.map(id => ({ id, name: id }))}
            selected={draft.conditions.departments}
            disabled={busy || simulating}
            onChange={ids => conditions({ departments: ids })}
          />
          <Checks
            legend="Tipos de solicitud"
            items={catalog.requestTypes.map(v => ({ id: v.id, name: v.name }))}
            selected={draft.conditions.requestTypeIds}
            disabled={busy || simulating}
            onChange={ids => conditions({ requestTypeIds: ids })}
          />
          <Checks
            legend="Debe tener todas estas etiquetas"
            items={catalog.tags.map(v => ({ id: v.id, name: v.name }))}
            selected={draft.conditions.allTagIds}
            disabled={busy || simulating}
            onChange={ids => conditions({ allTagIds: ids })}
          />
        </div>
      </details>
      <h4>Acciones internas</h4>
      <div className="automation-grid">
        <Checks
          legend="Añadir etiquetas"
          items={catalog.tags.map(v => ({ id: v.id, name: v.name }))}
          selected={draft.actions.addTagIds}
          disabled={busy || simulating}
          onChange={ids => actions({ addTagIds: ids })}
        />
        <label>
          Derivar departamento
          <select
            value={draft.actions.department ?? ''}
            disabled={busy || simulating}
            onChange={e => actions({ department: e.target.value || null })}
          >
            <option value="">Conservar departamento</option>
            {departments.map(value => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <Checks
          legend="Intentar asignar si no tiene responsable"
          items={staffOptions}
          selected={draft.actions.assignMemberIds}
          disabled={busy || simulating}
          onChange={ids => actions({ assignMemberIds: ids })}
        />
        <Checks
          legend="Crear tareas de estas plantillas"
          items={templates.map(v => ({ id: v.id, name: `${v.name} · v${v.version + 1}` }))}
          selected={draft.actions.taskTemplateIds}
          max={3}
          disabled={busy || simulating}
          onChange={ids => actions({ taskTemplateIds: ids })}
        />
      </div>
      <section className="automation-simulation">
        <h4>
          <FlaskConical size={16} />
          Simulación sin cambios
        </h4>
        <div className="automation-grid">
          <label>
            Número de ticket de muestra
            <input
              type="number"
              min={1}
              step={1}
              value={ticketId}
              disabled={busy || simulating}
              onChange={e => {
                setTicketId(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          <label>
            Evento de muestra
            <select
              value={sampleEvent}
              disabled={busy || simulating}
              onChange={e => {
                setSampleEvent(e.target.value as AutomationEventKind);
                setPreview(null);
              }}
            >
              {automationEventKinds.map(id => (
                <option value={id} key={id}>
                  {EVENT_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary"
            type="button"
            disabled={busy || simulating || !ticketId || !draft.name.trim()}
            onClick={() => void simulate()}
          >
            {simulating ? <LoaderCircle className="spin" size={15} /> : <FlaskConical size={15} />}Simular
          </button>
        </div>
        {validProof && preview && (
          <div className="automation-preview" role="status">
            <strong>
              {preview.plan.matches ? 'La regla coincide' : 'La muestra no cumple las condiciones'} · {preview.subject}
            </strong>
            {preview.plan.matches && (
              <ul>
                {preview.plan.addTagIds.length > 0 && (
                  <li>
                    Etiquetas:{' '}
                    {preview.plan.addTagIds
                      .map(id => catalog.tags.find(v => v.id === id)?.name ?? 'Etiqueta')
                      .join(', ')}
                  </li>
                )}
                {preview.plan.department && <li>Departamento: {preview.plan.department}</li>}
                {preview.plan.assignee && <li>Responsable propuesto: {preview.plan.assignee.name}</li>}
                {preview.plan.assignmentReason && <li>{preview.plan.assignmentReason}</li>}
                {preview.plan.tasks.map((task, index) => (
                  <li key={index}>
                    Tarea: {task.title}
                    {task.dueAfterHours !== null ? ` · ${task.dueAfterHours} horas corridas` : ''}
                  </li>
                ))}
              </ul>
            )}
            <small>
              La disponibilidad se comprueba nuevamente al ejecutar. Esta simulación permite habilitar esta
              configuración durante 15 minutos.
            </small>
          </div>
        )}
      </section>
      <label className="automation-check">
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={busy || simulating || (!draft.enabled && !validProof)}
          onChange={e => setDraft({ ...draft, enabled: e.target.checked })}
        />
        Habilitar esta regla para eventos nuevos
      </label>
      {draft.enabled && !validProof && (
        <p className="automation-help">
          Simula la configuración actual para conservar la regla habilitada, o desmárcala para guardarla pausada.
        </p>
      )}
      <div className="automation-actions">
        <button className="secondary" type="button" disabled={busy || simulating} onClick={onCancel}>
          Cancelar
        </button>
        <button
          className="primary"
          disabled={busy || simulating || !draft.name.trim() || (draft.enabled && !validProof)}
        >
          <Save size={15} />
          Guardar regla
        </button>
      </div>
    </form>
  );
}
function TaskTemplateEditor({
  existing,
  members,
  busy,
  onCancel,
  onSave,
}: {
  existing?: TaskTemplate;
  members: Member[];
  busy: boolean;
  onCancel: () => void;
  onSave: (template: { name: string; items: TaskTemplate['items'] }) => Promise<void>;
}) {
  const [name, setName] = useState(existing?.name ?? ''),
    [items, setItems] = useState<TaskTemplate['items']>(
      existing?.items ?? [{ title: '', assigneeMemberId: null, dueAfterHours: null }],
    );
  const update = (index: number, changes: Partial<TaskTemplate['items'][number]>) =>
    setItems(old => old.map((item, i) => (i === index ? { ...item, ...changes } : item)));
  return (
    <form
      className="automation-editor"
      onSubmit={e => {
        e.preventDefault();
        void onSave({ name, items });
      }}
    >
      <h3>{existing ? 'Editar plantilla' : 'Nueva plantilla'}</h3>
      <label>
        Nombre
        <input
          required
          maxLength={120}
          value={name}
          disabled={busy}
          onChange={e => setName(e.target.value)}
          autoFocus
        />
      </label>
      <p className="automation-help">
        Los plazos son horas corridas desde que se aplica la plantilla. Cambiarla requiere volver a simular las reglas
        que la usan.
      </p>
      {items.map((item, index) => (
        <fieldset key={index} className="automation-template-item">
          <legend>Tarea {index + 1}</legend>
          <label>
            Título
            <input
              required
              maxLength={200}
              value={item.title}
              disabled={busy}
              onChange={e => update(index, { title: e.target.value })}
            />
          </label>
          <div className="automation-grid">
            <label>
              Responsable
              <select
                value={item.assigneeMemberId ?? ''}
                disabled={busy}
                onChange={e => update(index, { assigneeMemberId: e.target.value || null })}
              >
                <option value="">Sin responsable</option>
                {item.assigneeMemberId &&
                  !members.some(v => v.id === item.assigneeMemberId && v.status === 'active' && v.hasAccount) && (
                    <option value={item.assigneeMemberId} disabled>
                      Integrante anterior sin acceso activo
                    </option>
                  )}
                {members
                  .filter(v => v.status === 'active' && v.hasAccount)
                  .map(member => (
                    <option value={member.id} key={member.id}>
                      {member.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Plazo en horas corridas, opcional
              <input
                type="number"
                min={1}
                max={8760}
                value={item.dueAfterHours ?? ''}
                disabled={busy}
                onChange={e => update(index, { dueAfterHours: e.target.value ? Number(e.target.value) : null })}
              />
            </label>
            <button
              className="text-button"
              type="button"
              disabled={busy || items.length === 1}
              onClick={() => setItems(old => old.filter((_, i) => i !== index))}
            >
              <X size={14} />
              Retirar tarea
            </button>
          </div>
        </fieldset>
      ))}
      <div className="automation-actions">
        <button
          className="secondary"
          type="button"
          disabled={busy || items.length >= 10}
          onClick={() => setItems(old => [...old, { title: '', assigneeMemberId: null, dueAfterHours: null }])}
        >
          <Plus size={15} />
          Añadir tarea
        </button>
        <button className="secondary" type="button" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
        <button className="primary" disabled={busy || !name.trim() || items.some(item => !item.title.trim())}>
          Guardar plantilla
        </button>
      </div>
    </form>
  );
}

export function TicketRelationsPanel({
  memberId,
  ticketId,
  refreshKey,
  onChanged,
}: {
  memberId: string;
  ticketId: number;
  refreshKey?: string | number;
  onChanged?: () => void;
}) {
  const [cursor, setCursor] = useState<string | null>(null),
    [previous, setPrevious] = useState<(string | null)[]>([]),
    [target, setTarget] = useState(''),
    [kind, setKind] = useState<'related' | 'duplicate'>('related'),
    [templateId, setTemplateId] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const saving = useRef(false);
  const links = useOrgResource<Page<TicketRelation>>(
      memberId,
      `/api/tickets/${ticketId}/relations?limit=25${cursor ? `&cursor=${cursor}` : ''}`,
      true,
      refreshKey,
    ),
    templates = useOrgResource<{ activeTemplates: TaskTemplate[] }>(memberId, '/api/task-templates');
  const selected = templates.data?.activeTemplates.find(v => v.id === templateId);
  const mutate = async (path: string, method: string, payload: unknown, scope?: string) => {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await orgRequest(memberId, path, method, payload);
      if (scope) getDraftOperations().clear(scope);
      links.reload();
      onChanged?.();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar.');
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const link = async (event: FormEvent) => {
    event.preventDefault();
    const payload = { targetTicketId: Number(target), kind },
      scope = `ticket-relation:${memberId}:${ticketId}`;
    if (
      await mutate(
        `/api/tickets/${ticketId}/relations`,
        'POST',
        { ...payload, operationId: getDraftOperations().forPayload(scope, payload) },
        scope,
      )
    ) {
      setTarget('');
      setNotice('Vínculo guardado. Los tickets conservan su contenido y plazos.');
    }
  };
  const apply = async () => {
    if (!selected) return;
    const payload = { templateId: selected.id, expectedTemplateVersion: selected.version },
      scope = `ticket-template:${memberId}:${ticketId}`;
    if (
      await mutate(
        `/api/tickets/${ticketId}/task-templates`,
        'POST',
        { ...payload, operationId: getDraftOperations().forPayload(scope, payload) },
        scope,
      )
    ) {
      setTemplateId('');
      setNotice('Las tareas de la plantilla se añadieron al ticket.');
    }
  };
  return (
    <section className="panel automation-panel">
      <div className="section-head">
        <h2>
          <LinkIcon size={17} />
          Casos relacionados y tareas
        </h2>
        <button
          className="secondary"
          type="button"
          disabled={busy || links.loading}
          onClick={() => {
            links.reload();
            templates.reload();
          }}
        >
          <RefreshCw size={14} />
          Actualizar
        </button>
      </div>
      <ErrorText>{error || links.error || templates.error}</ErrorText>
      {notice && (
        <p className="automation-preview" role="status">
          {notice}
        </p>
      )}
      <form className="automation-link-form" onSubmit={event => void link(event)}>
        <label>
          Número de otro ticket
          <input
            required
            type="number"
            min={1}
            step={1}
            value={target}
            disabled={busy}
            onChange={e => setTarget(e.target.value)}
          />
        </label>
        <label>
          Relación
          <select value={kind} disabled={busy} onChange={e => setKind(e.target.value as typeof kind)}>
            <option value="related">Relacionado</option>
            <option value="duplicate">Este ticket duplica al caso indicado</option>
          </select>
        </label>
        <button className="secondary" disabled={busy || !target || Number(target) === ticketId}>
          <Plus size={14} />
          Vincular
        </button>
      </form>
      <p className="automation-help">
        Los duplicados requieren la misma empresa y cuenta solicitante. Cada ticket mantiene su número, mensajes,
        archivos, correo y SLA.
      </p>
      <ul className="automation-list">
        {links.data?.items.map(relation => (
          <li key={relation.id}>
            <div>
              <strong>
                <a href={workspaceHome(currentWorkspaceId(), relation.otherTicket.id)}>
                  #{relation.otherTicket.id} · {relation.otherTicket.subject}
                  <ArrowUpRight size={13} />
                </a>
              </strong>
              <small>
                {relation.kind === 'related'
                  ? 'Relacionado'
                  : relation.isPrincipal
                    ? 'Este es el caso principal'
                    : 'Duplicado del caso indicado'}{' '}
                · {statusLabelCoarse(relation.otherTicket.status)}
              </small>
            </div>
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() =>
                void mutate(`/api/tickets/${ticketId}/relations`, 'PATCH', {
                  id: relation.id,
                  expectedVersion: relation.version,
                  archived: true,
                })
              }
            >
              Retirar vínculo
            </button>
          </li>
        ))}
      </ul>
      {!links.loading && !links.data?.items.length && (
        <p className="automation-help">Este ticket aún no tiene vínculos.</p>
      )}
      <Pager
        nextCursor={links.data?.nextCursor ?? null}
        loading={links.loading}
        canPrevious={previous.length > 0}
        previous={() => {
          setCursor(previous.at(-1) ?? null);
          setPrevious(v => v.slice(0, -1));
        }}
        next={() => {
          setPrevious(v => [...v, cursor]);
          setCursor(links.data!.nextCursor);
        }}
      />
      <details className="automation-template-apply">
        <summary>
          <ClipboardList size={15} />
          Añadir una plantilla de tareas internas
        </summary>
        <div className="automation-link-form">
          <label>
            Plantilla
            <select value={templateId} disabled={busy} onChange={e => setTemplateId(e.target.value)}>
              <option value="">Seleccionar…</option>
              {templates.data?.activeTemplates.map(template => (
                <option value={template.id} key={template.id}>
                  {template.name} · v{template.version + 1}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary" type="button" disabled={busy || !selected} onClick={() => void apply()}>
            Añadir tareas
          </button>
        </div>
        {selected && (
          <ul className="automation-template-preview">
            {selected.items.map((item, index) => (
              <li key={index}>
                {item.title}
                {item.dueAfterHours !== null ? ` · ${item.dueAfterHours} horas corridas` : ''}
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}

function AutomationRuleHistory({
  memberId,
  ruleId,
  onClose,
}: {
  memberId: string;
  ruleId: string;
  onClose: () => void;
}) {
  const [before, setBefore] = useState<number | null>(null),
    [previous, setPrevious] = useState<(number | null)[]>([]);
  const history = useOrgResource<{
    items: { version: number; rule: AutomationRule; createdAt: string }[];
    nextVersion: number | null;
  }>(memberId, `/api/automation/rules/${ruleId}/versions?limit=10${before !== null ? `&beforeVersion=${before}` : ''}`);
  return (
    <section className="automation-editor">
      <div className="section-head">
        <h3>Versiones de la regla</h3>
        <button type="button" className="text-button" onClick={onClose}>
          <X size={14} />
          Cerrar
        </button>
      </div>
      <ErrorText>{history.error}</ErrorText>
      {history.loading && (
        <p role="status" className="automation-help">
          Cargando versiones…
        </p>
      )}
      {history.data?.items.map(entry => (
        <details key={entry.version}>
          <summary>
            v{entry.version + 1} · {entry.rule.name} ·{' '}
            {entry.rule.archived ? 'Archivada' : entry.rule.enabled ? 'Habilitada' : 'Pausada'} ·{' '}
            {date(entry.createdAt)}
          </summary>
          <p className="automation-help">
            Orden {entry.rule.position}. Eventos:{' '}
            {entry.rule.conditions.events.map(value => EVENT_LABELS[value]).join(', ')}.{' '}
            {entry.rule.conditions.customerCompanyId ? 'Limitada a una empresa.' : 'Todas las empresas.'}{' '}
            {entry.rule.conditions.allTagIds.length} etiquetas requeridas. Acciones:{' '}
            {entry.rule.actions.addTagIds.length} etiquetas,{' '}
            {entry.rule.actions.department ? `departamento ${entry.rule.actions.department}, ` : ''}
            {entry.rule.actions.assignMemberIds.length} integrantes para reparto y{' '}
            {entry.rule.actions.taskTemplateIds.length} plantillas de tareas.
          </p>
        </details>
      ))}
      <div className="automation-pagination">
        <button
          type="button"
          className="secondary"
          disabled={history.loading || !previous.length}
          onClick={() => {
            setBefore(previous.at(-1) ?? null);
            setPrevious(v => v.slice(0, -1));
          }}
        >
          Más recientes
        </button>
        <button
          type="button"
          className="secondary"
          disabled={history.loading || history.data?.nextVersion === null || !history.data}
          onClick={() => {
            setPrevious(v => [...v, before]);
            setBefore(history.data!.nextVersion);
          }}
        >
          Anteriores
        </button>
      </div>
    </section>
  );
}
