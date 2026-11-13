'use client';
import { daybookFetch } from '@/lib/browser-request';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Edit3,
  Loader2,
  Plus,
  RefreshCw,
  Route,
  Trash2,
  UsersRound,
} from 'lucide-react';
import type { CustomerCompany, Member, TicketPriority } from '@/lib/types';
import type { ServicePolicyView } from '@/lib/service-policies';
import type { ServiceCalendar } from '@/lib/sla-policy';
import type { AssignmentRule } from '@/lib/automatic-assignment';
import type { AgentAvailability } from '@/lib/assignment-rules';
import { ClientRequestError } from '@/lib/client-request';
import { ConfirmDialog } from './desk-parts/shared';
import './operations-settings.css';
import { EmptyState, SkeletonList } from './estados';
type Saved = () => void | Promise<unknown>;
interface OperationsSettingsProps {
  companies: CustomerCompany[];
  members: Member[];
  departments: string[];
  memberId?: string;
  onSaved?: Saved;
}
type RuleDraft = Pick<
  AssignmentRule,
  'name' | 'customerCompanyId' | 'department' | 'enabled' | 'position' | 'agentMemberIds'
>;
const priorities: {
  key: TicketPriority;
  label: string;
}[] = [
  { key: 'urgent', label: 'Urgente' },
  { key: 'high', label: 'Alta' },
  { key: 'normal', label: 'Normal' },
  { key: 'low', label: 'Baja' },
];
const weekdays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'No se pudo completar la operación.');
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';
const isConflict = (error: unknown) => error instanceof ClientRequestError && error.status === 409;
function saved(callback?: Saved) {
  try {
    void Promise.resolve(callback?.()).catch(() => undefined);
  } catch {
    /* The configuration is already saved. */
  }
}
/** A fresh controller per request handles Strict Mode and prevents a completed
 * request for one account from updating another account's controls. */
function useOperationsRequests(memberId?: string) {
  const requests = useRef(new Set<AbortController>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const current = requests.current;
    return () => {
      alive.current = false;
      for (const request of current) request.abort();
      current.clear();
    };
  }, []);
  const request = useCallback(
    async <T,>(path: string, method = 'GET', body?: unknown): Promise<T> => {
      const controller = new AbortController();
      requests.current.add(controller);
      try {
        const headers = new Headers();
        if (body !== undefined) headers.set('Content-Type', 'application/json');
        if (memberId) headers.set('X-Daybook-Member-Id', memberId);
        const response = await daybookFetch(path, {
          method,
          headers,
          cache: 'no-store',
          signal: controller.signal,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const value: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
              ? value.error
              : 'No se pudo completar la operación. Intenta nuevamente.';
          throw new ClientRequestError(message, response.status);
        }
        if (!alive.current || controller.signal.aborted) throw new DOMException('Solicitud cancelada', 'AbortError');
        return value as T;
      } finally {
        requests.current.delete(controller);
      }
    },
    [memberId],
  );
  return { request, alive };
}
export function OperationsSettingsPanel(props: OperationsSettingsProps) {
  return (
    <div className="operations-settings" key={props.memberId || 'current-account'}>
      <div className="ops-intro">
        <span className="eyebrow">SERVICIO Y EQUIPO</span>
        <h2>Una atención que se adapta a cada empresa</h2>
        <p>Define los plazos, organiza el reparto y decide quién recibe nuevas solicitudes.</p>
      </div>
      <ServicePolicySettings companies={props.companies} memberId={props.memberId} onSaved={props.onSaved} />
      <AssignmentRulesSettings {...props} />
      <TeamAvailabilitySettings memberId={props.memberId} onSaved={props.onSaved} />
    </div>
  );
}
function SectionHeading({
  icon,
  title,
  detail,
  children,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <div className="ops-section-heading">
      <span className="ops-section-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
      {children}
    </div>
  );
}
function Notice({ message, error = false }: { message: string; error?: boolean }) {
  return message ? (
    <p className={`ops-notice${error ? ' ops-notice-error' : ''}`} role={error ? 'alert' : 'status'}>
      {!error && <CheckCircle2 size={16} aria-hidden="true" />}
      {message}
    </p>
  ) : null;
}
function Loading({ text = 'Cargando configuración…' }: { text?: string }) {
  return <SkeletonList label={text} rows={2} lines={1} />;
}
function ServicePolicySettings({
  companies,
  memberId,
  onSaved,
}: Pick<OperationsSettingsProps, 'companies' | 'memberId' | 'onSaved'>) {
  const [scope, setScope] = useState('default');
  const effectiveScope = scope === 'default' || companies.some(company => company.id === scope) ? scope : 'default';
  return (
    <section className="panel ops-panel">
      <SectionHeading
        icon={<CalendarClock size={21} />}
        title="Horarios y SLA de resolución"
        detail="Un calendario general y excepciones para quienes necesitan otro acuerdo."
      />
      <div className="ops-scope">
        <label>
          Configuración para
          <select value={effectiveScope} onChange={event => setScope(event.target.value)}>
            <option value="default">Configuración general</option>
            {companies.map(company => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <p>Los cambios se aplican a nuevos tickets y reaperturas. Los plazos ya establecidos se conservan.</p>
      </div>
      <ServicePolicyLoader key={effectiveScope} scope={effectiveScope} memberId={memberId} onSaved={onSaved} />
    </section>
  );
}
function ServicePolicyLoader({ scope, memberId, onSaved }: { scope: string; memberId?: string; onSaved?: Saved }) {
  const { request, alive } = useOperationsRequests(memberId);
  const [policy, setPolicy] = useState<ServicePolicyView | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    void request<{
      policy: ServicePolicyView;
    }>(`/api/service-policies/${encodeURIComponent(scope)}`)
      .then(result => {
        setPolicy(result.policy);
        setError('');
      })
      .catch(failure => {
        if (!isAbort(failure) && alive.current) setError(errorText(failure));
      });
  }, [scope, revision, request, alive]);
  async function refresh() {
    const result = await request<{
      policy: ServicePolicyView;
    }>(`/api/service-policies/${encodeURIComponent(scope)}`);
    setPolicy(result.policy);
    return result.policy;
  }
  async function mutate(method: string, body: unknown) {
    try {
      const result = await request<{
        policy: ServicePolicyView;
      }>(`/api/service-policies/${encodeURIComponent(scope)}`, method, body);
      setPolicy(result.policy);
      saved(onSaved);
      return result.policy;
    } catch (failure) {
      if (isConflict(failure)) await refresh().catch(() => undefined);
      throw failure;
    }
  }
  if (!policy)
    return (
      <>
        {error ? (
          <>
            <Notice error message={error} />
            <button
              className="secondary"
              type="button"
              onClick={() => {
                setError('');
                setRevision(value => value + 1);
              }}
            >
              <RefreshCw size={15} />
              Reintentar
            </button>
          </>
        ) : (
          <Loading />
        )}
      </>
    );
  return (
    <PolicyEditor
      policy={policy}
      scope={scope}
      onSave={draft => mutate('PUT', draft)}
      onReset={(expectedVersion, expectedId) => mutate('DELETE', { expectedVersion, expectedId })}
    />
  );
}
function PolicyEditor({
  policy,
  scope,
  onSave,
  onReset,
}: {
  policy: ServicePolicyView;
  scope: string;
  onSave: (draft: unknown) => Promise<ServicePolicyView>;
  onReset: (version: number, id: string | null) => Promise<ServicePolicyView>;
}) {
  const [calendar, setCalendar] = useState<ServiceCalendar>(() => structuredClone(policy.calendar));
  const [hours, setHours] = useState(() => ({ ...policy.slaHours }));
  const [holidays, setHolidays] = useState(() => policy.calendar.holidays.join('\n'));
  const [version, setVersion] = useState(policy.version);
  const [policyId, setPolicyId] = useState(policy.id);
  const [wasOverride, setWasOverride] = useState(policy.override);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const zoneList = useId();
  const conflicted = policyId !== policy.id || version !== policy.version || wasOverride !== policy.override;
  const apply = (next: ServicePolicyView) => {
    setCalendar(structuredClone(next.calendar));
    setHours({ ...next.slaHours });
    setHolidays(next.calendar.holidays.join('\n'));
    setVersion(next.version);
    setPolicyId(next.id);
    setWasOverride(next.override);
    setConfirmReset(false);
    setError('');
  };
  const setDay = (day: number, enabled: boolean) =>
    setCalendar(old => ({
      ...old,
      week: enabled
        ? [...old.week, { day, start: '09:00', end: '18:00' }].sort(
            (a, b) => a.day - b.day || a.start.localeCompare(b.start),
          )
        : old.week.filter(window => window.day !== day),
    }));
  const updateWindow = (index: number, field: 'start' | 'end', value: string) =>
    setCalendar(old => ({
      ...old,
      week: old.week.map((window, i) => (i === index ? { ...window, [field]: value } : window)),
    }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || conflicted) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const dates = [
        ...new Set(
          holidays
            .split(/[\s,;]+/)
            .map(date => date.trim())
            .filter(Boolean),
        ),
      ].sort();
      const next = await onSave({
        expectedVersion: version,
        expectedId: policyId,
        calendar: { ...calendar, holidays: dates },
        slaHours: hours,
      });
      apply(next);
      setNotice('Horario y plazos guardados. Los tickets actuales conservan su vencimiento.');
    } catch (failure) {
      if (!isAbort(failure)) setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    if (busy || conflicted) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      apply(await onReset(version, policyId));
      setNotice(
        scope === 'default'
          ? 'Atención continua restaurada; se mantienen las horas por prioridad.'
          : 'La empresa vuelve a usar la configuración general.',
      );
    } catch (failure) {
      if (!isAbort(failure)) setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="ops-policy-form" onSubmit={submit}>
      {scope !== 'default' && (
        <p className="ops-inheritance">
          <span className={`ops-badge${policy.override ? ' ops-badge-gold' : ''}`}>
            {policy.override ? 'SLA propio' : 'Usa el SLA general'}
          </span>
          {policy.override
            ? 'Esta empresa tiene un horario y plazos propios.'
            : 'Puedes guardar una excepción para esta empresa.'}
        </p>
      )}
      <fieldset disabled={busy || conflicted} className="ops-fieldset">
        <legend>Cómo corre el plazo</legend>
        <div className="ops-two-columns">
          <label>
            Horario de atención
            <select
              value={calendar.mode}
              onChange={event => setCalendar(old => ({ ...old, mode: event.target.value as ServiceCalendar['mode'] }))}
            >
              <option value="always">Atención continua · 24 horas, todos los días</option>
              <option value="business">Horario hábil · solo los tramos definidos</option>
            </select>
          </label>
          <label>
            Zona horaria
            <input
              value={calendar.timeZone}
              list={zoneList}
              required
              maxLength={100}
              onChange={event => setCalendar(old => ({ ...old, timeZone: event.target.value }))}
            />
            <datalist id={zoneList}>
              <option value="America/Santiago" />
              <option value="America/Punta_Arenas" />
              <option value="UTC" />
              <option value="America/Bogota" />
              <option value="Europe/Madrid" />
            </datalist>
          </label>
        </div>
        {calendar.mode === 'business' && (
          <div className="ops-week">
            <p className="ops-help">
              Selecciona los días y sus tramos. Puedes añadir una pausa de almuerzo separando mañana y tarde. Para el
              final del día usa 24:00.
            </p>
            {weekdays.map((name, offset) => {
              const day = offset + 1;
              const windows = calendar.week
                .map((window, index) => ({ ...window, index }))
                .filter(window => window.day === day);
              return (
                <div className="ops-day" key={day}>
                  <label className="ops-checkbox">
                    <input
                      type="checkbox"
                      checked={windows.length > 0}
                      onChange={event => setDay(day, event.target.checked)}
                    />
                    <span>{name}</span>
                  </label>
                  <div className="ops-day-windows">
                    {windows.map((window, number) => (
                      <div className="ops-time-window" key={`${day}:${number}`}>
                        <label>
                          <span className="sr-only">
                            Inicio {name}, tramo {number + 1}
                          </span>
                          <input
                            type="time"
                            required
                            value={window.start}
                            aria-label={`Inicio ${name}, tramo ${number + 1}`}
                            onChange={event => updateWindow(window.index, 'start', event.target.value)}
                          />
                        </label>
                        <ArrowRight size={14} aria-hidden="true" />
                        <label>
                          <span className="sr-only">
                            Fin {name}, tramo {number + 1}
                          </span>
                          <input
                            type="text"
                            required
                            value={window.end}
                            maxLength={5}
                            pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00"
                            placeholder="18:00"
                            aria-label={`Fin ${name}, tramo ${number + 1}`}
                            onChange={event => updateWindow(window.index, 'end', event.target.value)}
                          />
                        </label>
                        <button
                          className="ops-icon-button"
                          type="button"
                          aria-label={`Quitar tramo ${number + 1} de ${name}`}
                          onClick={() =>
                            setCalendar(old => ({
                              ...old,
                              week: old.week.filter((_, index) => index !== window.index),
                            }))
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                    {windows.length > 0 && windows.length < 4 && (
                      <button
                        className="ops-text-button"
                        type="button"
                        disabled={windows.at(-1)?.end === '24:00'}
                        title={
                          windows.at(-1)?.end === '24:00'
                            ? 'Reduce el fin del último tramo antes de añadir otro.'
                            : undefined
                        }
                        onClick={() =>
                          setCalendar(old => ({
                            ...old,
                            week: [...old.week, { day, start: windows.at(-1)?.end || '09:00', end: '24:00' }],
                          }))
                        }
                      >
                        <Plus size={14} />
                        Añadir tramo
                      </button>
                    )}
                    {!windows.length && <span className="ops-day-closed">Sin atención</span>}
                  </div>
                </div>
              );
            })}
            <label className="ops-holidays">
              Fechas sin atención
              <textarea
                rows={3}
                value={holidays}
                onChange={event => setHolidays(event.target.value)}
                placeholder={'2026-12-25\n2027-01-01'}
              />
              <small>Una fecha por línea, en formato AAAA-MM-DD. Estas fechas no consumen horas hábiles.</small>
            </label>
          </div>
        )}
      </fieldset>
      <fieldset className="ops-fieldset" disabled={busy || conflicted}>
        <legend>Plazo de resolución por prioridad</legend>
        <div className="ops-priority-hours">
          {priorities.map(priority => (
            <label key={priority.key}>
              <span>
                <i className={`ops-priority-dot ops-priority-${priority.key}`} aria-hidden="true" />
                {priority.label}
              </span>
              <div>
                <input
                  type="number"
                  min={1}
                  max={8760}
                  step={0.25}
                  required
                  value={hours[priority.key]}
                  onChange={event => setHours(old => ({ ...old, [priority.key]: Number(event.target.value) }))}
                  aria-label={`Horas para prioridad ${priority.label.toLowerCase()}`}
                />
                <span>horas</span>
              </div>
            </label>
          ))}
        </div>
        <p className="ops-help">
          El aviso por falta de respuesta sigue siendo de dos horas corridas y los recordatorios continúan durante las
          24 horas.
        </p>
      </fieldset>
      {conflicted && (
        <div className="ops-conflict" role="alert">
          <p>
            Otra persona actualizó esta configuración. Tu borrador se conserva; carga la versión actual antes de
            guardar.
          </p>
          <button type="button" className="secondary" onClick={() => apply(policy)}>
            <RefreshCw size={15} />
            Cargar versión actual
          </button>
        </div>
      )}
      <Notice error message={error} />
      <Notice message={notice} />
      <div className="ops-form-actions">
        {policy.override && (
          <div className="ops-reset">
            {confirmReset ? (
              <>
                <span>{scope === 'default' ? '¿Restaurar atención continua?' : '¿Usar el SLA general de nuevo?'}</span>
                <button
                  className="ops-text-button ops-danger"
                  type="button"
                  disabled={busy || conflicted}
                  onClick={() => void reset()}
                >
                  Confirmar
                </button>
                <button
                  className="ops-text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmReset(false)}
                >
                  Cancelar
                </button>
              </>
            ) : (
              <button
                className="ops-text-button"
                type="button"
                disabled={busy || conflicted}
                onClick={() => setConfirmReset(true)}
              >
                {scope === 'default' ? 'Restaurar atención continua' : 'Usar configuración general'}
              </button>
            )}
          </div>
        )}
        <button className="primary" type="submit" disabled={busy || conflicted}>
          {busy ? <Loader2 className="ops-spin" size={16} /> : <Check size={16} />}{' '}
          {scope !== 'default' && !policy.override ? 'Guardar SLA propio' : 'Guardar horario y SLA'}
        </button>
      </div>
    </form>
  );
}
function AssignmentRulesSettings({ companies, members, departments, memberId, onSaved }: OperationsSettingsProps) {
  const { request, alive } = useOperationsRequests(memberId);
  const [rules, setRules] = useState<AssignmentRule[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const [editorBusy, setEditorBusy] = useState(false);
  const loadEpoch = useRef(0);
  const load = useCallback(async () => {
    const epoch = ++loadEpoch.current;
    const result = await request<{
      rules: AssignmentRule[];
    }>('/api/assignment-rules');
    if (epoch === loadEpoch.current) setRules(result.rules);
    return result.rules;
  }, [request]);
  useEffect(() => {
    const epoch = ++loadEpoch.current;
    void request<{
      rules: AssignmentRule[];
    }>('/api/assignment-rules')
      .then(result => {
        if (epoch !== loadEpoch.current) return;
        setRules(result.rules);
        setError('');
      })
      .catch(failure => {
        if (!isAbort(failure) && alive.current && epoch === loadEpoch.current) setError(errorText(failure));
      });
  }, [request, revision, alive]);
  const activeStaff = members.filter(
    member => member.role !== 'client' && member.status === 'active' && member.hasAccount,
  );
  const selected = editing && editing !== 'new' ? rules?.find(rule => rule.id === editing) : undefined;
  async function saveRule(draft: RuleDraft, expectedVersion: number) {
    const creating = editing === 'new';
    try {
      const result = await request<{
        rule: AssignmentRule;
      }>(creating ? '/api/assignment-rules' : `/api/assignment-rules/${editing}`, creating ? 'POST' : 'PATCH', {
        ...draft,
        ...(creating ? {} : { expectedVersion }),
      });
      loadEpoch.current++;
      setRules(old =>
        [...(old || []).filter(rule => rule.id !== result.rule.id), result.rule].sort(
          (a, b) => a.position - b.position || a.id.localeCompare(b.id),
        ),
      );
      setEditing(null);
      setNotice('Regla guardada. Se aplicará a nuevos tickets que no tengan un responsable elegido.');
      saved(onSaved);
      return result.rule;
    } catch (failure) {
      if (isConflict(failure)) await load().catch(() => undefined);
      throw failure;
    }
  }
  async function deleteRule(rule: AssignmentRule, expectedVersion: number) {
    try {
      await request(`/api/assignment-rules/${rule.id}`, 'DELETE', { expectedVersion });
      loadEpoch.current++;
      setRules(old => (old || []).filter(item => item.id !== rule.id));
      setEditing(null);
      setNotice('Regla eliminada. Los responsables actuales se conservan.');
      saved(onSaved);
    } catch (failure) {
      if (isConflict(failure)) await load().catch(() => undefined);
      throw failure;
    }
  }
  return (
    <section className="panel ops-panel">
      <SectionHeading
        icon={<Route size={21} />}
        title="Reparto automático"
        detail="La primera regla que coincida decide el grupo. Recibe el ticket quien tenga menos carga."
      >
        <button
          className="secondary"
          type="button"
          disabled={rules === null || editorBusy}
          onClick={() => {
            setEditing('new');
            setNotice('');
          }}
        >
          <Plus size={15} />
          Nueva regla
        </button>
      </SectionHeading>
      <div className="ops-routing-note">
        <span className="ops-badge ops-badge-gold">Control del equipo</span>
        <p>
          Solo cuentan agentes activos, disponibles y con capacidad. Si el grupo está completo, el ticket queda sin
          asignar. La asignación manual tiene prioridad.
        </p>
      </div>
      {error && (
        <>
          <Notice error message={error} />
          <button className="secondary" type="button" onClick={() => setRevision(value => value + 1)}>
            <RefreshCw size={15} />
            Reintentar
          </button>
        </>
      )}
      {rules === null && !error ? (
        <Loading text="Cargando reglas…" />
      ) : (
        <>
          {editing && (
            <RuleEditor
              key={editing}
              rule={selected}
              isNew={editing === 'new'}
              companies={companies}
              members={members}
              departments={departments}
              onSave={saveRule}
              onDelete={deleteRule}
              onBusyChange={setEditorBusy}
              onCancel={() => setEditing(null)}
            />
          )}
          <div className="ops-rule-list">
            {rules?.map(rule => (
              <div className="ops-rule" key={rule.id}>
                <span className="ops-rule-order" title="Orden de evaluación">
                  {rule.position}
                </span>
                <div className="ops-rule-copy">
                  <div>
                    <strong>{rule.name}</strong>
                    <span className={`ops-badge${rule.enabled ? ' ops-badge-gold' : ''}`}>
                      {rule.enabled ? 'Activa' : 'En pausa'}
                    </span>
                  </div>
                  <p>
                    {rule.customerCompanyId
                      ? companies.find(company => company.id === rule.customerCompanyId)?.name || 'Empresa anterior'
                      : 'Todas las empresas'}{' '}
                    <span>·</span> {rule.department || 'Todos los departamentos'}
                  </p>
                  <small>
                    {rule.agentMemberIds
                      .map(id => members.find(member => member.id === id)?.name || 'Cuenta anterior')
                      .join(', ')}
                  </small>
                </div>
                <button
                  className="secondary"
                  type="button"
                  disabled={editorBusy}
                  onClick={() => {
                    setEditing(rule.id);
                    setNotice('');
                  }}
                >
                  <Edit3 size={14} />
                  Editar<span className="sr-only"> {rule.name}</span>
                </button>
              </div>
            ))}
          </div>
          {!rules?.length && !editing && (
            <EmptyState
              icon={<Route size={22} />}
              title="El reparto sigue en tus manos"
              text="Crea una regla y elige cuándo activarla. Tus tickets actuales conservarán su responsable."
            />
          )}
          {!activeStaff.length && (
            <p className="ops-help">Necesitas una cuenta activa del equipo para configurar el reparto.</p>
          )}
        </>
      )}
      <Notice message={notice} />
    </section>
  );
}
function RuleEditor({
  rule,
  isNew,
  companies,
  members,
  departments,
  onSave,
  onDelete,
  onBusyChange,
  onCancel,
}: {
  rule?: AssignmentRule;
  isNew: boolean;
  companies: CustomerCompany[];
  members: Member[];
  departments: string[];
  onSave: (draft: RuleDraft, expectedVersion: number) => Promise<AssignmentRule>;
  onDelete: (rule: AssignmentRule, expectedVersion: number) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
}) {
  const initial = (): RuleDraft =>
    rule
      ? {
          name: rule.name,
          customerCompanyId: rule.customerCompanyId,
          department: rule.department,
          enabled: rule.enabled,
          position: rule.position,
          agentMemberIds: [...rule.agentMemberIds],
        }
      : { name: '', customerCompanyId: null, department: null, enabled: false, position: 100, agentMemberIds: [] };
  const [draft, setDraft] = useState<RuleDraft>(initial);
  const [version, setVersion] = useState(rule?.version ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const conflicted = !isNew && (!rule || rule.version !== version);
  const choices = members.filter(
    member =>
      (member.role !== 'client' && member.status === 'active' && member.hasAccount) ||
      draft.agentMemberIds.includes(member.id),
  );
  const unknown = draft.agentMemberIds.filter(id => !members.some(member => member.id === id));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || conflicted) return;
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      await onSave(draft, version);
    } catch (failure) {
      if (!isAbort(failure)) setError(errorText(failure));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  async function remove() {
    if (!rule || busy || conflicted) return;
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      await onDelete(rule, version);
    } catch (failure) {
      if (!isAbort(failure)) setError(errorText(failure));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <form className="ops-rule-editor" onSubmit={submit}>
      <div className="ops-editor-title">
        <h4>{isNew ? 'Nueva regla de reparto' : 'Editar regla'}</h4>
        <label className="ops-checkbox">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={busy || conflicted}
            onChange={event => setDraft(old => ({ ...old, enabled: event.target.checked }))}
          />
          <span>Regla activa</span>
        </label>
      </div>
      <fieldset className="ops-fieldset" disabled={busy || conflicted}>
        <legend className="sr-only">Condiciones de la regla</legend>
        <div className="ops-two-columns">
          <label>
            Nombre de la regla
            <input
              required
              maxLength={160}
              placeholder="Ej.: soporte de empresa"
              value={draft.name}
              onChange={event => setDraft(old => ({ ...old, name: event.target.value }))}
            />
          </label>
          <label>
            Orden · menor primero
            <input
              required
              type="number"
              min={0}
              max={10000}
              step={1}
              value={draft.position}
              onChange={event => setDraft(old => ({ ...old, position: Number(event.target.value) }))}
            />
          </label>
          <label>
            Empresa
            <select
              value={draft.customerCompanyId || ''}
              onChange={event => setDraft(old => ({ ...old, customerCompanyId: event.target.value || null }))}
            >
              <option value="">Todas las empresas</option>
              {draft.customerCompanyId && !companies.some(company => company.id === draft.customerCompanyId) && (
                <option value={draft.customerCompanyId}>Empresa anterior</option>
              )}
              {companies.map(company => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Departamento
            <select
              value={draft.department || ''}
              onChange={event => setDraft(old => ({ ...old, department: event.target.value || null }))}
            >
              <option value="">Todos los departamentos</option>
              {draft.department && !departments.includes(draft.department) && (
                <option value={draft.department}>{draft.department} · anterior</option>
              )}
              {departments.map(department => (
                <option key={department}>{department}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="ops-agents-choice">
          <strong>Agentes que pueden recibir estos tickets</strong>
          <p className="ops-help">
            Se considera su carga de tickets abiertos y en espera. En empate se elige a quien lleve más tiempo sin una
            asignación automática.
          </p>
          <div className="ops-checkbox-grid">
            {choices.map(member => {
              const active = member.status === 'active' && member.role !== 'client' && member.hasAccount;
              return (
                <label className="ops-checkbox-card" key={member.id}>
                  <input
                    type="checkbox"
                    checked={draft.agentMemberIds.includes(member.id)}
                    onChange={event =>
                      setDraft(old => ({
                        ...old,
                        agentMemberIds: event.target.checked
                          ? [...old.agentMemberIds, member.id]
                          : old.agentMemberIds.filter(id => id !== member.id),
                      }))
                    }
                  />
                  <span>
                    <strong>{member.name}</strong>
                    <small>
                      {active
                        ? member.role === 'owner'
                          ? 'Propietario'
                          : member.role === 'admin'
                            ? 'Administrador'
                            : 'Agente'
                        : 'Sin acceso activo · quítalo para activar la regla'}
                    </small>
                  </span>
                </label>
              );
            })}
            {unknown.map(id => (
              <label className="ops-checkbox-card" key={id}>
                <input
                  type="checkbox"
                  checked
                  onChange={() =>
                    setDraft(old => ({ ...old, agentMemberIds: old.agentMemberIds.filter(value => value !== id) }))
                  }
                />
                <span>
                  <strong>Cuenta anterior</strong>
                  <small>Quitar de la regla</small>
                </span>
              </label>
            ))}
          </div>
        </div>
      </fieldset>
      {conflicted && (
        <div className="ops-conflict" role="alert">
          <p>
            La regla cambió o fue eliminada. Tu borrador sigue aquí; revisa la configuración actual antes de guardar.
          </p>
          {rule && (
            <button
              className="secondary"
              type="button"
              onClick={() => {
                setDraft(initial());
                setVersion(rule.version);
                setError('');
                setConfirmDelete(false);
              }}
            >
              <RefreshCw size={15} />
              Cargar versión actual
            </button>
          )}
        </div>
      )}
      <Notice error message={error} />
      <div className="ops-form-actions">
        {!isNew && rule && (
          <div className="ops-reset">
            {confirmDelete && (
              <ConfirmDialog
                title="Eliminar regla de reparto"
                description="Los tickets nuevos dejan de repartirse con esta regla. Los que ya se asignaron conservan su responsable. No se puede deshacer."
                confirmLabel="Eliminar regla"
                busy={busy}
                onClose={() => setConfirmDelete(false)}
                onConfirm={async () => {
                  await remove();
                  setConfirmDelete(false);
                }}
              />
            )}
            {
              <button
                type="button"
                className="ops-text-button ops-danger"
                disabled={busy || conflicted}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={14} />
                Eliminar regla
              </button>
            }
          </div>
        )}
        <button className="secondary" type="button" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
        <button className="primary" type="submit" disabled={busy || conflicted || !draft.agentMemberIds.length}>
          {busy ? <Loader2 className="ops-spin" size={16} /> : <Check size={16} />}Guardar regla
        </button>
      </div>
      {isNew && (
        <p className="ops-help">
          La regla comienza en pausa. Marca «Regla activa» cuando quieras que intervenga en las nuevas solicitudes.
        </p>
      )}
    </form>
  );
}
function TeamAvailabilitySettings({ memberId, onSaved }: Pick<OperationsSettingsProps, 'memberId' | 'onSaved'>) {
  const { request, alive } = useOperationsRequests(memberId);
  const [agents, setAgents] = useState<AgentAvailability[] | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const loadEpoch = useRef(0);
  const load = useCallback(async () => {
    const epoch = ++loadEpoch.current;
    const result = await request<{
      agents: AgentAvailability[];
    }>('/api/agent-availability');
    if (epoch === loadEpoch.current) setAgents(result.agents);
    return result.agents;
  }, [request]);
  useEffect(() => {
    const epoch = ++loadEpoch.current;
    void request<{
      agents: AgentAvailability[];
    }>('/api/agent-availability')
      .then(result => {
        if (epoch !== loadEpoch.current) return;
        setAgents(result.agents);
        setError('');
      })
      .catch(failure => {
        if (!isAbort(failure) && alive.current && epoch === loadEpoch.current) setError(errorText(failure));
      });
  }, [request, revision, alive]);
  async function update(agent: AgentAvailability, available: boolean, capacity: number, expectedVersion: number) {
    try {
      const result = await request<{
        agent: AgentAvailability;
      }>('/api/agent-availability', 'PATCH', { memberId: agent.memberId, expectedVersion, available, capacity });
      loadEpoch.current++;
      setAgents(old => (old || []).map(item => (item.memberId === result.agent.memberId ? result.agent : item)));
      saved(onSaved);
      return result.agent;
    } catch (failure) {
      if (isConflict(failure)) await load().catch(() => undefined);
      throw failure;
    }
  }
  return (
    <section className="panel ops-panel">
      <SectionHeading
        icon={<UsersRound size={21} />}
        title="Disponibilidad del equipo"
        detail="Pausa el ingreso de nuevas asignaciones y define una capacidad por agente."
      >
        <button type="button" className="secondary" onClick={() => setRevision(value => value + 1)}>
          <RefreshCw size={15} />
          Actualizar
        </button>
      </SectionHeading>
      <p className="ops-help">
        La capacidad solo limita el reparto automático. Las asignaciones manuales y los tickets actuales se conservan.
      </p>
      <Notice error message={error} />
      {agents === null && !error ? (
        <Loading text="Cargando disponibilidad…" />
      ) : (
        <div className="ops-availability-list">
          {agents?.map(agent => (
            <AvailabilityRow key={agent.memberId} agent={agent} onSave={update} />
          ))}
        </div>
      )}
      {agents?.length === 0 && <p className="ops-help">Aquí aparecerán las cuentas activas del equipo.</p>}
    </section>
  );
}
function AvailabilityRow({
  agent,
  onSave,
}: {
  agent: AgentAvailability;
  onSave: (
    agent: AgentAvailability,
    available: boolean,
    capacity: number,
    version: number,
  ) => Promise<AgentAvailability>;
}) {
  const [available, setAvailable] = useState(agent.available);
  const [capacity, setCapacity] = useState(agent.capacity);
  const [version, setVersion] = useState(agent.version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const conflicted = version !== agent.version;
  const changed = available !== agent.available || capacity !== agent.capacity;
  const reset = (value: AgentAvailability) => {
    setAvailable(value.available);
    setCapacity(value.capacity);
    setVersion(value.version);
    setError('');
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || conflicted || !changed) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      reset(await onSave(agent, available, capacity, version));
      setNotice('Disponibilidad guardada.');
    } catch (failure) {
      if (!isAbort(failure)) setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="ops-availability-row" onSubmit={submit}>
      <div className="ops-agent-name">
        <span className="ops-avatar" aria-hidden="true">
          {agent.name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <strong>{agent.name}</strong>
          <small>{agent.openTickets} tickets abiertos o en espera</small>
        </div>
      </div>
      <label className="ops-checkbox">
        <input
          type="checkbox"
          checked={available}
          disabled={busy || conflicted}
          onChange={event => setAvailable(event.target.checked)}
        />
        <span>Recibe nuevos tickets</span>
      </label>
      <label className="ops-capacity">
        Capacidad
        <input
          type="number"
          min={1}
          max={500}
          step={1}
          required
          value={capacity}
          disabled={busy || conflicted}
          onChange={event => setCapacity(Number(event.target.value))}
          aria-label={`Capacidad automática de ${agent.name}`}
        />
      </label>
      <button className="secondary" type="submit" disabled={busy || conflicted || !changed}>
        {busy ? <Loader2 className="ops-spin" size={15} /> : <Check size={15} />}Guardar
        <span className="sr-only"> disponibilidad de {agent.name}</span>
      </button>
      {conflicted && (
        <div className="ops-row-message" role="alert">
          Esta disponibilidad cambió. Tu borrador se conserva.{' '}
          <button type="button" className="ops-text-button" onClick={() => reset(agent)}>
            Cargar versión actual
          </button>
        </div>
      )}
      {error && (
        <div className="ops-row-message">
          <Notice error message={error} />
        </div>
      )}
      {notice && !conflicted && (
        <div className="ops-row-message">
          <Notice message={notice} />
        </div>
      )}
    </form>
  );
}
export function MyAvailabilityPanel({ memberId }: { memberId: string }) {
  return <OwnAvailability key={memberId} memberId={memberId} />;
}
function OwnAvailability({ memberId }: { memberId: string }) {
  const { request, alive } = useOperationsRequests(memberId);
  const [agent, setAgent] = useState<AgentAvailability | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const atCapacity = agent !== null && agent.openTickets >= agent.capacity;
  const load = useCallback(async () => {
    const result = await request<{
      agents: AgentAvailability[];
    }>('/api/agent-availability');
    const own = result.agents.find(item => item.memberId === memberId);
    if (!own) throw new Error('Tu disponibilidad no está disponible. Actualiza el acceso.');
    setAgent(own);
    return own;
  }, [memberId, request]);
  useEffect(() => {
    void request<{
      agents: AgentAvailability[];
    }>('/api/agent-availability')
      .then(result => {
        const own = result.agents.find(item => item.memberId === memberId);
        if (!own) throw new Error('Tu disponibilidad no está disponible. Actualiza el acceso.');
        setAgent(own);
        setError('');
      })
      .catch(failure => {
        if (!isAbort(failure) && alive.current) setError(errorText(failure));
      });
  }, [memberId, request, revision, alive]);
  async function toggle() {
    if (!agent || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request<{
        agent: AgentAvailability;
      }>('/api/agent-availability', 'PATCH', { memberId, expectedVersion: agent.version, available: !agent.available });
      setAgent(result.agent);
      setNotice(
        result.agent.available
          ? 'Disponibilidad activada. Recibirás nuevos tickets cuando tengas capacidad y coincida una regla.'
          : 'El reparto automático está en pausa para tu cuenta.',
      );
    } catch (failure) {
      if (isConflict(failure)) await load().catch(() => undefined);
      if (!isAbort(failure) && alive.current) setError(errorText(failure));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="panel ops-my-availability">
      <div className="ops-my-heading">
        <span className="ops-section-icon" aria-hidden="true">
          <UsersRound size={19} />
        </span>
        <div>
          <h3>Tu disponibilidad</h3>
          <p>
            {agent
              ? agent.available
                ? atCapacity
                  ? 'El reparto espera hasta que tengas capacidad'
                  : 'Puedes recibir tickets cuando coincida una regla'
                : 'El reparto automático está en pausa'
              : 'Consultando tu estado…'}
          </p>
        </div>
        {agent && (
          <span className={`ops-badge${agent.available && !atCapacity ? ' ops-badge-gold' : ''}`}>
            {agent.available ? (atCapacity ? 'Capacidad completa' : 'Disponible') : 'En pausa'}
          </span>
        )}
      </div>
      <p className="ops-help">Conservas tus tickets y puedes seguir respondiendo mientras estés en pausa.</p>
      {agent ? (
        <div className="ops-my-footer">
          <span>
            {agent.openTickets} de {agent.capacity} tickets de capacidad automática
          </span>
          <button className="secondary" type="button" disabled={busy} onClick={() => void toggle()}>
            {busy ? <Loader2 className="ops-spin" size={15} /> : <ChevronDown size={15} />}{' '}
            {agent.available ? 'Pausar nuevas asignaciones' : 'Volver a recibir tickets'}
          </button>
        </div>
      ) : (
        !error && <Loading />
      )}
      <Notice error message={error} />
      {error && (
        <button
          className="ops-text-button"
          type="button"
          disabled={busy}
          onClick={() => setRevision(value => value + 1)}
        >
          <RefreshCw size={14} />
          Actualizar estado
        </button>
      )}
      <Notice message={notice} />
    </section>
  );
}
