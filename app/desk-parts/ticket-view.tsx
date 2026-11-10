'use client';
import { useTicketConversation } from '@/hooks/use-ticket-search';
import { isTestTicket } from '@/lib/test-data';
import { ticketDraftKey } from '@/lib/ticket-drafts';
import { ArrowLeft, CheckCheck, Clock3 } from 'lucide-react';
import { Combobox } from '../combobox';
import { type TicketPatch } from '@/lib/ticket-overlay';
import { type Member, type Ticket, type TicketPriority, type TicketStatus, type Workspace } from '../../lib/types';
import { TicketRelationsPanel } from '../automation';
import { MailTracking } from '../mail-tracking';
import { TicketServiceContextPanel } from '../service-context';
import { AssignmentControls, TicketActivity, TicketCompanyLink } from '../team-tools';
import { TicketChat } from '../ticket-chat';
import { TicketDetails } from '../ticket-details';
import { TicketPresence } from '../ticket-presence';
import { TicketOrganizationPanel } from '../work-organization';
import { STATUS, PRIORITY, fmtDate, sla, Avatar, Status, Priority, request, DeskRun, ReplyTarget } from './shared';
import { StaffComposer } from './staff-composer';

export function TicketView({
  data,
  current,
  conversation,
  busy,
  isAdmin,
  now,
  accessKey,
  email,
  clientMembers,
  replyTarget,
  setReplyTarget,
  run,
  refresh,
  change,
  savingField,
  onAssigned,
  onBack,
}: {
  data: Workspace;
  current: Ticket;
  conversation: ReturnType<typeof useTicketConversation>;
  busy: boolean;
  isAdmin: boolean;
  now: number;
  accessKey: string;
  email: string;
  clientMembers: Member[];
  replyTarget: ReplyTarget;
  setReplyTarget: (value: ReplyTarget) => void;
  run: DeskRun;
  refresh: () => Promise<unknown>;
  change: (ticket: Ticket, body: TicketPatch, offerUndo?: boolean) => Promise<boolean>;
  savingField: (key: keyof Ticket) => boolean;
  onAssigned: (ticket: Ticket) => void;
  onBack: () => void;
}) {
  return (
    <>
      <button className="back-button" disabled={busy} onClick={onBack}>
        <ArrowLeft size={16} />
        Volver a la bandeja
      </button>
      <div className="page-heading">
        <div>
          <div className="ticket-meta">
            <span>#{String(current.id).padStart(4, '0')}</span>
            <Status status={current.status} />
            <Priority priority={current.priority} />
          </div>
          <h1 className="ticket-title">{current.subject}</h1>
          <p>
            Creado el {fmtDate(current.createdAt)} · {current.department}
          </p>
        </div>
        <button
          className="primary"
          disabled={savingField('status')}
          onClick={() => {
            void change(current, { status: current.status === 'resolved' ? 'open' : 'resolved' });
          }}
        >
          <CheckCheck size={17} />
          {current.status === 'resolved' ? 'Reabrir ticket' : 'Marcar resuelto'}
        </button>
      </div>
      {data.viewer && (
        <TicketPresence key={`${data.viewer.id}:${current.id}`} ticketId={current.id} memberId={data.viewer.id} />
      )}
      {isAdmin && (
        <div className="info-note test-ticket-control">
          <label>
            <input
              type="checkbox"
              checked={Boolean(current.isTest)}
              disabled={busy}
              onChange={event => {
                void run(
                  () =>
                    request(`/api/tickets/${current.id}`, 'PATCH', {
                      isTest: event.target.checked,
                      expectedVersion: current.version,
                    }),
                  'Marca de prueba actualizada',
                );
              }}
            />{' '}
            Ticket de prueba
          </label>
          <small>
            {isTestTicket(current, data.members)
              ? 'Excluido de métricas por defecto. El contenido se conserva.'
              : 'Incluido en métricas.'}
            {!current.isTest && isTestTicket(current, data.members)
              ? ' La cuenta solicitante está marcada como prueba.'
              : ''}
          </small>
        </div>
      )}
      <div className="detail-grid">
        <section className="conversation ticket-chat-panel" aria-label="Conversación del ticket">
          <TicketChat
            key={`${data.viewer!.id}:${current.id}`}
            ticketId={current.id}
            collaboration={Boolean(data.evolution?.features.collaboration)}
            onReplyTo={message => setReplyTarget({ memberId: data.viewer!.id, ticketId: current.id, message })}
            messages={conversation.messages}
            viewerId={data.viewer!.id}
            staff
            hasOlder={conversation.hasOlder}
            loadingOlder={conversation.loadingOlder}
            onLoadOlder={conversation.loadOlder}
            loading={conversation.loading}
            error={conversation.error}
            title="Conversación del ticket"
          >
            {data.viewer && (
              <StaffComposer
                key={ticketDraftKey({ memberId: data.viewer.id, role: data.viewer.role, ticketId: current.id })}
                ticket={current}
                viewer={data.viewer}
                replyTarget={
                  replyTarget?.memberId === data.viewer.id && replyTarget.ticketId === current.id
                    ? replyTarget.message
                    : null
                }
                onClearReply={() => setReplyTarget(null)}
                collaboration={Boolean(data.evolution?.features.collaboration)}
                members={data.members}
                savedReplies={data.savedReplies || []}
                legacyEmail={email}
                busy={busy}
                onSave={message =>
                  run(() => request(`/api/tickets/${current.id}/messages`, 'POST', message), 'Mensaje guardado')
                }
              />
            )}
          </TicketChat>
        </section>
        <TicketDetails>
          <div className="detail-fields">
            <label>
              Estado
              <select
                value={current.status}
                disabled={savingField('status')}
                aria-busy={savingField('status')}
                onChange={e => {
                  void change(current, { status: e.target.value as TicketStatus });
                }}
              >
                {Object.entries(STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Prioridad
              <select
                value={current.priority}
                disabled={savingField('priority')}
                aria-busy={savingField('priority')}
                onChange={e => {
                  void change(current, { priority: e.target.value as TicketPriority });
                }}
              >
                {Object.entries(PRIORITY).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {data.viewer && (
              <AssignmentControls
                key={`${current.id}:${current.version}`}
                ticket={current}
                members={data.members}
                viewerId={data.viewer.id}
                busy={savingField('assigneeMemberId')}
                onSaved={onAssigned}
                onConflict={() => {
                  void refresh();
                }}
              />
            )}
            <Combobox
              label="Cuenta del cliente"
              value={current.requesterMemberId || ''}
              disabled={savingField('requesterMemberId')}
              busy={savingField('requesterMemberId')}
              options={[
                { value: '', label: 'Sin cuenta vinculada' },
                ...(current.requesterMemberId && !clientMembers.some(member => member.id === current.requesterMemberId)
                  ? [
                      {
                        value: current.requesterMemberId,
                        label: `${current.requesterName} · sin acceso activo`,
                        disabled: true,
                      },
                    ]
                  : []),
                ...clientMembers.map(member => ({ value: member.id, label: member.name, hint: member.email })),
              ]}
              onChange={value => {
                void change(current, { requesterMemberId: value || null });
              }}
              description="La cuenta elegida podrá consultar este ticket y las respuestas públicas."
            />
            {isAdmin ? (
              <TicketCompanyLink
                key={`${current.id}:${current.customerCompanyId}`}
                ticket={current}
                companies={data.companies || []}
                busy={busy}
                run={run}
              />
            ) : (
              <p className="assignment-note">
                Empresa:{' '}
                {data.companies?.find(company => company.id === current.customerCompanyId)?.name || 'Sin empresa'}
              </p>
            )}
            <label>
              Departamento
              <select
                value={current.department}
                disabled={savingField('department')}
                aria-busy={savingField('department')}
                onChange={e => {
                  void change(current, { department: e.target.value });
                }}
              >
                {[...new Set([...data.settings.departments, current.department])].map(a => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            <div className={`sla-card ${sla(current, now) === 'Vencido' ? 'late' : ''}`}>
              <Clock3 size={18} />
              <div>
                <strong>{sla(current, now)}</strong>
                <small>Plazo: {fmtDate(current.dueAt)}</small>
              </div>
            </div>
          </div>
          <div className="requester">
            <span className="eyebrow">SOLICITANTE</span>
            <div>
              <Avatar name={current.requesterName} />
              <strong>{current.requesterName}</strong>
            </div>
            <a href={`mailto:${current.requesterEmail}`}>{current.requesterEmail}</a>
          </div>
        </TicketDetails>
      </div>
      {data.evolution?.features.organization && (
        <TicketOrganizationPanel
          key={`org:${accessKey}:${current.id}`}
          ticketId={current.id}
          memberId={data.viewer!.id}
          staff
          members={data.members}
          refreshKey={current.version}
          onChanged={() => {
            void refresh();
          }}
        />
      )}
      {data.evolution?.features.serviceContext && (
        <TicketServiceContextPanel
          key={`service:${accessKey}:${current.id}:${current.customerCompanyId}`}
          memberId={data.viewer!.id}
          ticketId={current.id}
          companyId={current.customerCompanyId}
        />
      )}
      {data.evolution?.features.automation && (
        <TicketRelationsPanel
          key={`relations:${accessKey}:${current.id}`}
          memberId={data.viewer!.id}
          ticketId={current.id}
          refreshKey={current.version}
          onChanged={() => {
            void refresh();
          }}
        />
      )}
      <TicketActivity
        key={`activity:${accessKey}:${current.id}:${current.version}`}
        ticketId={current.id}
        members={data.members}
        companies={data.companies || []}
      />
      <MailTracking key={`mail:${accessKey}:${current.id}`} ticketId={current.id} refreshKey={current.version} />
    </>
  );
}
