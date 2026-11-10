'use client';
import { currentWorkspaceId } from '@/lib/workspace-client';
import { Bell, Check, Sparkles, Users } from 'lucide-react';
import { useState } from 'react';
import { type Member, type Settings } from '../../lib/types';
import { ROLE_LABELS } from '../access-panel';

export function SettingsForm({ settings, members, busy, onSave }: {
    settings: Settings;
    members: Member[];
    busy: boolean;
    onSave: (s: Partial<Settings>) => Promise<boolean>;
}) {
    const [s, setS] = useState(settings);
    const [departments, setDepartments] = useState(settings.departments.join('\n'));
    const notificationMembers = members.filter(member => ['owner', 'admin', 'agent'].includes(member.role) && ['active', 'invited'].includes(member.status));
    const eligibleIds = new Set(notificationMembers.map(member => member.id));
    const selectedIds = s.notificationMemberIds || [];
    const selectedEligibleIds = selectedIds.filter(id => eligibleIds.has(id));
    const toggleRecipient = (id: string, selected: boolean) => setS(previous => ({
        ...previous,
        notificationMemberIds: selected
            ? [...new Set([...(previous.notificationMemberIds || []), id])]
            : (previous.notificationMemberIds || []).filter(current => current !== id),
    }));
    return <form className="settings-form" onSubmit={event => {
        event.preventDefault();
        onSave({ ...(currentWorkspaceId()==='daybook'?{brandName:s.brandName}:{}), tagline: s.tagline, agents: s.agents, notificationMemberIds: selectedEligibleIds, departments: departments.split('\n').map(value => value.trim()).filter(Boolean) });
    }}>
        <section className="panel settings-section">
            <div><span className="setting-icon"><Sparkles size={22}/></span><h2>Identidad de marca</h2><p>El nombre y la voz de tu producto.</p></div>
            <div className="form"><label>Nombre del producto<input required maxLength={120} disabled={currentWorkspaceId()!=='daybook'} value={currentWorkspaceId()==='daybook'?s.brandName:settings.brandName} onChange={event => setS({ ...s, brandName: event.target.value })}/>{currentWorkspaceId()!=='daybook'&&<small>Gestiona este nombre en la incorporación del negocio.</small>}</label><label>Frase de marca<input required maxLength={180} value={s.tagline} onChange={event => setS({ ...s, tagline: event.target.value })}/></label></div>
        </section>
        <section className="panel settings-section">
            <div><span className="setting-icon"><Users size={22}/></span><h2>Organización</h2><p>Un departamento por línea. Gestiona las cuentas responsables desde Equipo y clientes.</p></div>
            <div className="form form-grid"><label>Departamentos<textarea required rows={5} value={departments} onChange={event => setDepartments(event.target.value)}/></label></div>
        </section>
        <section className="panel settings-section">
            <div><span className="setting-icon"><Bell size={22}/></span><h2>Notificaciones</h2><p>Comparte el seguimiento de las solicitudes con las personas de tu equipo.</p></div>
            <div className="form">
                <fieldset className="notification-recipients" disabled={busy} aria-describedby="notification-responsibles-help">
                    <legend>Responsables de los avisos</legend>
                    <p id="notification-responsibles-help">Recibirán avisos de tickets nuevos y respuestas de clientes, aunque el ticket esté asignado a otra persona.</p>
                    <div className="notification-recipient-list">{notificationMembers.map(member => <label className="notification-recipient" key={member.id}>
                        <input type="checkbox" checked={selectedIds.includes(member.id)} onChange={event => toggleRecipient(member.id, event.target.checked)}/>
                        <span><strong>{member.name}</strong><small>{member.email} · {ROLE_LABELS[member.role]}</small>{member.status === 'invited' && <small className="notification-recipient-pending">Invitación pendiente: recibirá avisos cuando active su cuenta.</small>}</span>
                    </label>)}</div>
                    {selectedEligibleIds.length === 0 && <p className="notification-recipient-note">Sin selección se avisa al responsable asignado o al equipo disponible.</p>}
                    {selectedEligibleIds.length !== selectedIds.length && <p className="notification-recipient-note">Las cuentas que ya no tienen acceso se quitarán de la selección al guardar.</p>}
                </fieldset>
            </div>
        </section>

        <div className="form-footer"><button className="primary" disabled={busy}><Check size={17}/>Guardar configuración</button></div>
    </form>;
}
