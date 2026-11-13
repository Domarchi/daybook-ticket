'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Building2, Check, Clock3, Edit3, Plus, RefreshCw, UserCheck } from 'lucide-react';
import type { Member, Ticket } from '@/lib/types';
import { Combobox } from './combobox';
import { clientRequest, ClientRequestError } from '@/lib/client-request';
import { SkeletonList } from './estados';

export type CompanyItem = { id: string; name: string; createdAt: string; updatedAt: string };
export type RunAction = (
  action: () => Promise<unknown>,
  message: string,
  undo?: { run: () => void },
) => Promise<boolean>;
type Activity = {
  id: string;
  actorName: string;
  action: string;
  beforeValue: string | null;
  afterValue: string | null;
  createdAt: string;
};
const date = (value: string) =>
  new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const actionLabels: Record<string, string> = {
  automation_applied: 'Regla interna aplicada',
  task_template_applied: 'Plantilla de tareas aplicada',
  ticket_linked: 'Caso vinculado',
  ticket_unlinked: 'Vínculo retirado',
  service_context: 'Contexto del servicio actualizado',
  organization: 'Organización del ticket actualizada',
  task_created: 'Tarea interna creada',
  task_updated: 'Tarea interna actualizada',
  isTest: 'Marca de prueba',
  category: 'Clasificación actualizada',
  automatic_assignment: 'Asignación automática',
  status: 'Estado actualizado',
  priority: 'Prioridad actualizada',
  assigneeMemberId: 'Responsable actualizado',
  customerCompanyId: 'Empresa actualizada',
  requesterMemberId: 'Solicitante actualizado',
  subject: 'Asunto actualizado',
  department: 'Departamento actualizado',
  created: 'Ticket creado',
  ticket_created: 'Ticket creado',
  claimed: 'Ticket tomado',
  assigned: 'Responsable actualizado',
  reassigned: 'Responsable actualizado',
  assignment_changed: 'Responsable actualizado',
  status_changed: 'Estado actualizado',
  priority_changed: 'Prioridad actualizada',
  department_changed: 'Departamento actualizado',
  company_linked: 'Empresa vinculada',
  company_changed: 'Empresa actualizada',
  replied: 'Respuesta registrada',
  reply_created: 'Respuesta registrada',
  note_created: 'Nota interna registrada',
  reopened: 'Ticket reabierto',
  resolved: 'Ticket resuelto',
  updated: 'Ticket actualizado',
};

export function AssignmentControls({
  ticket,
  members,
  viewerId,
  busy,
  onSaved,
  onConflict,
}: {
  ticket: Ticket;
  members: Member[];
  viewerId: string;
  busy: boolean;
  onSaved: (ticket: Ticket) => void;
  onConflict: () => void;
}) {
  const [assignee, setAssignee] = useState(ticket.assigneeMemberId || '');
  const [saving, setSaving] = useState(false),
    [problem, setProblem] = useState('');
  const staff = members.filter(member => member.role !== 'client' && member.status === 'active');
  // Only the assignment controls wait while this saves; the rest of the ticket stays usable.
  const save = async (claim: boolean) => {
    setSaving(true);
    setProblem('');
    try {
      const result = await clientRequest<{ ticket: Ticket }>(
        `/api/tickets/${ticket.id}${claim ? '/claim' : ''}`,
        claim ? 'POST' : 'PATCH',
        { expectedVersion: ticket.version, ...(claim ? {} : { assigneeMemberId: assignee || null }) },
      );
      if (result?.ticket) onSaved(result.ticket);
    } catch (error) {
      if (error instanceof ClientRequestError && error.status === 409) {
        onConflict();
        setProblem(
          'Otra persona actualizó este ticket. Mostramos la asignación actual; revísala antes de volver a cambiarla.',
        );
      } else setProblem(error instanceof Error ? error.message : 'No se pudo cambiar la asignación.');
    } finally {
      setSaving(false);
    }
  };
  const wait = busy || saving;
  return (
    <div className="ticket-assignment-controls" aria-busy={wait}>
      {!ticket.assigneeMemberId && (
        <button className="secondary" type="button" disabled={wait} onClick={() => save(true)}>
          <UserCheck size={16} />
          Tomar ticket
        </button>
      )}
      {ticket.assigneeMemberId === viewerId && (
        <p className="assignment-note">
          <Check size={14} />
          Tú eres responsable de este ticket.
        </p>
      )}
      <Combobox
        label="Responsable"
        value={assignee}
        disabled={wait}
        busy={wait}
        onChange={setAssignee}
        options={[
          { value: '', label: 'Sin asignar' },
          ...(ticket.assigneeMemberId && !staff.some(member => member.id === ticket.assigneeMemberId)
            ? [{ value: ticket.assigneeMemberId, label: `${ticket.assignee} · sin acceso activo`, disabled: true }]
            : []),
          ...staff.map(member => ({ value: member.id, label: member.name, hint: member.email })),
        ]}
      />
      {assignee !== (ticket.assigneeMemberId || '') && (
        <button className="secondary" type="button" disabled={wait} onClick={() => save(false)}>
          Confirmar asignación
        </button>
      )}
      {problem && (
        <p className="field-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

export function TicketCompanyLink({
  ticket,
  companies,
  busy,
  run,
}: {
  ticket: Ticket;
  companies: CompanyItem[];
  busy: boolean;
  run: RunAction;
}) {
  const [companyId, setCompanyId] = useState(ticket.customerCompanyId || '');
  return (
    <div className="ticket-company-link">
      <Combobox
        label="Empresa del ticket"
        value={companyId}
        disabled={busy}
        busy={busy}
        onChange={setCompanyId}
        options={[
          { value: '', label: 'Sin empresa' },
          ...companies.map(company => ({ value: company.id, label: company.name })),
        ]}
      />
      <small>
        Los contactos con acceso a toda esta empresa podrán ver este ticket y sus respuestas públicas. Este cambio
        conserva el vencimiento actual.
      </small>
      {companyId !== (ticket.customerCompanyId || '') && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() =>
            run(
              () =>
                clientRequest(`/api/tickets/${ticket.id}`, 'PATCH', {
                  customerCompanyId: companyId || null,
                  expectedVersion: ticket.version,
                }),
              'Empresa del ticket actualizada',
            )
          }
        >
          Confirmar vínculo de empresa
        </button>
      )}
    </div>
  );
}

export function TicketActivity({
  ticketId,
  members,
  companies,
}: {
  ticketId: number;
  members: Member[];
  companies: CompanyItem[];
}) {
  const [events, setEvents] = useState<Activity[]>([]);
  const displayValue = (action: string, value: string | null) => {
    if (action === 'isTest') return value === 'true' ? 'Prueba' : 'Uso real';
    if (action === 'automatic_assignment') {
      try {
        const target = JSON.parse(value || 'null');
        return typeof target?.name === 'string' ? target.name : 'Responsable asignado';
      } catch {
        return 'Responsable asignado';
      }
    }
    if (action === 'service_context') {
      try {
        const context = JSON.parse(value || '{}');
        return `${Array.isArray(context.assetIds) ? context.assetIds.length : 0} equipos · ${Array.isArray(context.contractIds) ? context.contractIds.length : 0} contratos`;
      } catch {
        return 'Contexto del servicio';
      }
    }
    if (action === 'assigneeMemberId' || action === 'requesterMemberId')
      return value ? members.find(member => member.id === value)?.name || 'Cuenta anterior' : 'Sin asignar';
    if (action === 'customerCompanyId')
      return value ? companies.find(company => company.id === value)?.name || 'Empresa anterior' : 'Sin empresa';
    const labels: Record<string, string> = {
      open: 'Abierto',
      pending: 'En espera (retirado)',
      resolved: 'Solucionado',
      closed: 'Cerrado',
      low: 'Baja',
      normal: 'Normal',
      high: 'Alta',
      urgent: 'Urgente',
    };
    return value ? labels[value] || value : 'Sin valor';
  };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void clientRequest<{ events: Activity[] }>(`/api/tickets/${ticketId}/events`)
      .then(result => {
        if (active) {
          setEvents(result.events);
          setError('');
        }
      })
      .catch(failure => {
        if (active) setError(failure instanceof Error ? failure.message : 'No se pudo cargar la actividad.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ticketId, revision]);
  return (
    <section className="panel ticket-activity">
      <div className="section-head">
        <h2>
          <Clock3 size={17} />
          Actividad del ticket
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Actualizar actividad"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setRevision(value => value + 1);
          }}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <SkeletonList label="Cargando actividad…" rows={3} lines={1} />
      ) : events.length ? (
        <ol>
          {events.map(event => (
            <li key={event.id}>
              <div>
                <strong>{actionLabels[event.action] || 'Actualización del ticket'}</strong>
                <time dateTime={event.createdAt}>{date(event.createdAt)}</time>
              </div>
              <p>
                {event.actorName}
                {(event.beforeValue !== null || event.afterValue !== null) && (
                  <span>
                    {' '}
                    · {event.beforeValue !== null ? `${displayValue(event.action, event.beforeValue)} → ` : ''}
                    {displayValue(event.action, event.afterValue)}
                  </span>
                )}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p>Los nuevos cambios de este ticket aparecerán aquí.</p>
      )}
    </section>
  );
}

export function CompaniesPanel({ companies, busy, run }: { companies: CompanyItem[]; busy: boolean; run: RunAction }) {
  const [editing, setEditing] = useState<CompanyItem | 'new' | null>(null);
  return (
    <section className="panel companies-panel">
      <div className="section-head">
        <h2>
          <Building2 size={18} />
          Empresas cliente
        </h2>
        <button type="button" className="secondary" disabled={busy} onClick={() => setEditing('new')}>
          <Plus size={15} />
          Nueva empresa
        </button>
      </div>
      <p className="panel-help">
        Agrupa los contactos de cada empresa y decide quién puede consultar sus tickets. Los tickets anteriores se
        vinculan de forma explícita desde su detalle.
      </p>
      {editing && (
        <CompanyForm
          key={editing === 'new' ? 'new' : editing.id}
          company={editing === 'new' ? undefined : editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={async name => {
            if (
              await run(
                () =>
                  clientRequest(
                    editing === 'new' ? '/api/companies' : `/api/companies/${editing.id}`,
                    editing === 'new' ? 'POST' : 'PATCH',
                    { name },
                  ),
                'Empresa guardada',
              )
            )
              setEditing(null);
          }}
        />
      )}
      <ul className="company-list">
        {companies.map(company => (
          <li key={company.id}>
            <strong>{company.name}</strong>
            <button type="button" className="text-button" disabled={busy} onClick={() => setEditing(company)}>
              <Edit3 size={14} />
              Editar<span className="sr-only"> {company.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {!companies.length && (
        <p className="panel-help">Aún no hay empresas. Crea la primera para vincular a sus contactos.</p>
      )}
    </section>
  );
}
function CompanyForm({
  company,
  busy,
  onCancel,
  onSave,
}: {
  company?: CompanyItem;
  busy: boolean;
  onCancel: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(company?.name || '');
  return (
    <form
      className="form company-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (name.trim()) void onSave(name.trim());
      }}
    >
      <label>
        Nombre de la empresa
        <input
          value={name}
          maxLength={160}
          required
          disabled={busy}
          onChange={event => setName(event.target.value)}
          autoFocus
        />
      </label>
      <div className="form-footer">
        <button className="secondary" type="button" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
        <button className="primary" disabled={busy || !name.trim()}>
          Guardar empresa
        </button>
      </div>
    </form>
  );
}

export function MemberCompanyEditor({
  member,
  companies,
  busy,
  run,
}: {
  member: Member;
  companies: CompanyItem[];
  busy: boolean;
  run: RunAction;
}) {
  const [companyId, setCompanyId] = useState(member.customerCompanyId || '');
  const [access, setAccess] = useState<'own' | 'manager'>(member.companyAccess || 'own');
  const changed = companyId !== (member.customerCompanyId || '') || access !== member.companyAccess;
  return (
    <div className="member-company-editor">
      <label>
        <span className="sr-only">Empresa de {member.name}</span>
        <select
          value={companyId}
          disabled={busy || member.status === 'revoked'}
          onChange={event => {
            setCompanyId(event.target.value);
            setAccess('own');
          }}
        >
          <option value="">Sin empresa</option>
          {companies.map(company => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">Tickets visibles para {member.name}</span>
        <select
          value={access}
          disabled={busy || !companyId || member.status === 'revoked'}
          onChange={event => setAccess(event.target.value as 'own' | 'manager')}
        >
          <option value="own">Solo sus tickets</option>
          <option value="manager">Todos los tickets de la empresa</option>
        </select>
      </label>
      {access === 'manager' && <small>Verá y podrá responder los tickets vinculados a su empresa.</small>}
      {changed && (
        <button
          className="text-button"
          type="button"
          disabled={busy}
          onClick={() =>
            run(
              () =>
                clientRequest(`/api/members/${member.id}`, 'PATCH', {
                  customerCompanyId: companyId || null,
                  companyAccess: companyId ? access : 'own',
                }),
              'Acceso de empresa actualizado',
            )
          }
        >
          Confirmar acceso
        </button>
      )}
    </div>
  );
}
