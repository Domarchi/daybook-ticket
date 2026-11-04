'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Check, Copy, Mail, Plus, RefreshCw, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import type { MailStatus, Member, MemberRole, Workspace } from '../lib/types';
import './access-panel.css';
import { CompaniesPanel, MemberCompanyEditor } from './team-tools';

export const ROLE_LABELS: Record<MemberRole, string> = { owner: 'Propietario', admin: 'Administrador', agent: 'Agente', client: 'Cliente' };
const MEMBER_STATUS = { invited: 'Invitación pendiente', active: 'Activo', revoked: 'Acceso revocado' };
type Run = (action: () => Promise<unknown>, message: string) => Promise<boolean>;

async function request<T = unknown>(path: string, method: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result && typeof result === 'object' && 'error' in result ? result.error : null;
    throw new Error(typeof message === 'string' ? message : 'No se pudo completar la operación.');
  }
  return result as T;
}

export function AccessPanel({ data, busy, run }: { data: Workspace; busy: boolean; run: Run }) {
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('all');
  const [invitation, setInvitation] = useState<{ memberId: string; email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const invitationInput = useRef<HTMLInputElement>(null);
  const isOwner = data.viewer?.role === 'owner';
  const canManage = (member: Member) => member.role !== 'owner' && member.id !== data.viewer?.id && (isOwner || member.role !== 'admin');
  const roles: MemberRole[] = isOwner ? ['client', 'agent', 'admin'] : ['client', 'agent'];
  const rows = data.members.filter(member => filter === 'all' || filter === 'staff' && member.role !== 'client' || filter === 'client' && member.role === 'client');

  const invite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (await run(async () => {
      const result = await request<{ member: Member; invitationUrl: string }>('/api/members', 'POST', { name: form.get('name'), email: form.get('email'), role: form.get('role') });
      setInvitation({ memberId: result.member.id, email: result.member.email, url: result.invitationUrl });
      setCopied(false);
    }, 'Invitación creada')) setCreating(false);
  };

  const renew = (member: Member) => run(async () => {
    const result = await request<{ invitationUrl: string }>(`/api/members/${member.id}/invite`, 'POST', {});
    setInvitation({ memberId: member.id, email: member.email, url: result.invitationUrl }); setCopied(false);
  }, 'Nuevo enlace de invitación creado');

  const update = (member: Member, body: { role?: MemberRole; status?: 'active' | 'invited' | 'revoked' }) => run(async () => {
    await request(`/api/members/${member.id}`, 'PATCH', body);
    if (invitation?.memberId === member.id && body.status === 'revoked') setInvitation(null);
  }, body.status === 'revoked' ? 'Acceso revocado' : 'Acceso actualizado');

  const copy = async () => {
    if (!invitation) return;
    try { await navigator.clipboard.writeText(invitation.url); setCopied(true); }
    catch { invitationInput.current?.focus(); invitationInput.current?.select(); }
  };

  return <>
    <div className="page-heading"><div><span className="eyebrow"><span className="tiny-line" />CADA PERSONA, SU ACCESO</span><h1>Equipo y clientes</h1><p>Invita a las personas que atenderán solicitudes y a los clientes que las crearán.</p></div><button className="primary" disabled={busy} onClick={() => setCreating(!creating)}>{creating ? <X size={17} /> : <UserPlus size={17} />}{creating ? 'Cerrar formulario' : 'Invitar persona'}</button></div>
    <div className="access-summary"><div><Users size={21} /><strong>{data.members.filter(member => member.role !== 'client' && member.status !== 'revoked').length}</strong><span>personas en el equipo</span></div><div><UserPlus size={21} /><strong>{data.members.filter(member => member.role === 'client' && member.status !== 'revoked').length}</strong><span>clientes con acceso</span></div><div><Mail size={21} /><strong>{data.members.filter(member => member.status === 'invited').length}</strong><span>invitaciones pendientes</span></div></div>
    {creating && <section className="panel access-invite"><div className="section-head"><h2>Una nueva persona en Daybook</h2><ShieldCheck size={18} /></div><form className="form" onSubmit={invite}><div className="form-grid"><label>Nombre<input name="name" required maxLength={120} placeholder="Nombre y apellido" autoFocus disabled={busy} /></label><label>Correo de acceso<input name="email" type="email" required maxLength={254} placeholder="persona@empresa.com" disabled={busy} /></label><label>Rol<select name="role" defaultValue="client" disabled={busy}>{roles.map(role => <option value={role} key={role}>{ROLE_LABELS[role]}</option>)}</select></label><div className="access-role-help"><p><strong>Cliente:</strong> crea tickets y consulta los permitidos según su acceso.</p><p><strong>Agente:</strong> atiende la bandeja compartida.</p>{isOwner && <p><strong>Administrador:</strong> además gestiona accesos y configuración.</p>}</div></div><div className="form-footer"><button type="button" className="secondary" disabled={busy} onClick={() => setCreating(false)}>Cancelar</button><button className="primary" disabled={busy}><Plus size={16} />Crear invitación</button></div></form></section>}
    {invitation && <section className="access-invitation-result" aria-label="Enlace de invitación"><div><span className="access-result-icon"><Check size={19} /></span><div><h2>Invitación para {invitation.email}</h2><p>Comparte este enlace con la persona invitada para que cree su contraseña.</p></div><button className="icon-button" aria-label="Ocultar enlace de invitación" onClick={() => setInvitation(null)}><X size={18} /></button></div><div className="access-link-field"><input ref={invitationInput} readOnly value={invitation.url} aria-label="Enlace de invitación" onFocus={event => event.target.select()} /><button className="secondary" onClick={copy}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copiado' : 'Copiar enlace'}</button></div><small>{data.mailStatus?.configured ? 'La notificación por correo se puede consultar en Configuración.' : 'El correo aún no está configurado. Puedes compartir el enlace directamente.'}</small></section>}
    <CompaniesPanel companies={data.companies || []} busy={busy} run={run}/>
    <section className="panel"><div className="access-list-head"><h2>Directorio de accesos</h2><select aria-label="Filtrar personas por rol" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todas las personas</option><option value="staff">Equipo</option><option value="client">Clientes</option></select></div><div className="access-table-scroll"><table className="access-table"><thead><tr><th>Persona</th><th>Rol</th><th>Empresa y visibilidad</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{rows.map(member => <tr key={member.id}><td><strong>{member.name}{member.id === data.viewer?.id && <span className="access-you">Tú</span>}</strong><small>{member.email}</small></td><td>{canManage(member) ? <select aria-label={`Rol de ${member.name}`} value={member.role} disabled={busy || member.status === 'revoked'} onChange={event => update(member, { role: event.target.value as MemberRole })}>{roles.map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select> : <span className="access-role"><ShieldCheck size={14} />{ROLE_LABELS[member.role]}</span>}</td><td>{member.role === 'client' ? <MemberCompanyEditor key={`${member.id}:${member.customerCompanyId}:${member.companyAccess}`} member={member} companies={data.companies || []} busy={busy} run={run}/> : <span className="access-protected">Equipo Daybook</span>}</td><td><span className={`access-status ${member.status}`}>{MEMBER_STATUS[member.status]}</span></td><td><div className="access-row-actions">{canManage(member) && <>{member.status === 'invited' && <button className="text-button" disabled={busy} onClick={() => renew(member)}>Renovar enlace</button>}{member.status === 'revoked' ? <button className="text-button" disabled={busy} onClick={() => update(member, { status: member.hasAccount ? 'active' : 'invited' })}>Restaurar acceso</button> : <button className="text-button access-revoke" disabled={busy} onClick={() => update(member, { status: 'revoked' })}>Revocar acceso</button>}</>}{member.role === 'owner' && <span className="access-protected">Acceso del propietario</span>}</div></td></tr>)}</tbody></table></div>{rows.length === 0 && <div className="access-empty">No hay personas en esta vista.</div>}</section>
    <div className="info-note access-privacy"><ShieldCheck size={18} /><p>Cada cliente ve sus tickets. Los contactos con acceso a toda su empresa también pueden consultar y responder los tickets vinculados a ella. Las notas internas siguen reservadas al equipo.</p></div>
  </>;
}

export function MailPanel({ status, busy, run }: { status: MailStatus | null; busy: boolean; run: Run }) {
  const counts = status?.counts || {}, delivery = status?.deliveryCounts || {};
  const pending = (counts.awaiting_configuration || 0) + (counts.queued || 0) + (counts.processing || 0);
  return <section className="panel mail-panel"><div className="section-head"><h2><Mail size={18}/>Correos que mantienen conectado al equipo</h2><span className={`access-status ${status?.configured ? 'active' : 'invited'}`}>{status?.configured ? 'Configurado' : 'Pendiente de configuración'}</span></div><div className="mail-panel-body">
    <p>{status?.configured ? `Remitente: ${status.sender}` : 'El proveedor de correo aún no está conectado en este entorno.'}</p>
    <div className="mail-counts"><div><strong>{pending}</strong><span>Pendientes</span></div><div><strong>{counts.accepted || 0}</strong><span>Aceptados por el proveedor</span></div><div><strong>{delivery.delivered || 0}</strong><span>Entrega confirmada</span></div><div><strong>{delivery.bounced || 0}</strong><span>Rebotados</span></div><div><strong>{counts.failed || 0}</strong><span>Fallidos</span></div><div><strong>{counts.unknown || 0}</strong><span>Por revisar</span></div></div>
    {status?.lastError && <p className="mail-last-error">Hay notificaciones que requieren revisión. El historial de cada ticket muestra su estado.</p>}
    <div className="mail-panel-footer"><div><p>Los correos llevan el logo de Daybook y un enlace al portal. La conversación y los archivos permanecen protegidos.</p><small>{status?.webhookConfigured ? 'El seguimiento distingue los envíos aceptados de las entregas confirmadas. Una entrega no confirma que la persona haya leído el correo.' : 'El seguimiento de entrega está pendiente de conexión. Los envíos antiguos permanecen sin confirmación.'} Los pendientes también pueden procesarse desde aquí.</small></div><button className="secondary" disabled={busy || !status?.configured} onClick={() => run(() => request('/api/notifications/process', 'POST', {}), 'Cola de notificaciones revisada')}><RefreshCw size={15}/>Procesar pendientes</button></div>
  </div></section>;
}
