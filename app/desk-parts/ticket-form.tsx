'use client';
import { useDraftAttachments } from '@/hooks/use-draft-attachments';
import { getDraftOperations } from '@/lib/draft-operations';
import { clearNewTicketDraft, readNewTicketDraft, readNewTicketOrganization, writeNewTicketDraft, writeNewTicketOrganization } from '@/lib/new-ticket-draft';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { type Member, type Settings } from '../../lib/types';
import { AttachmentComposer } from '../attachments';
import { KnowledgeSuggestions } from '../knowledge';
import { type OrganizationRequestValue, RequestOrganizationFields } from '../work-organization';
import { PRIORITY } from './shared';

export function TicketForm({ viewer, settings, members, busy, onCancel, onSubmit, organizationEnabled,knowledgeEnabled }: {
    knowledgeEnabled:boolean;
    organizationEnabled: boolean;
    viewer: Member;
    settings: Settings;
    members: Member[];
    busy: boolean;
    onCancel: () => void;
    onSubmit: (body: unknown) => Promise<boolean>;
}) {
    const scope = `${viewer.id}:${viewer.role}:new-ticket`;
    const [initialDraft] = useState(() => readNewTicketDraft(scope));
    const [requesterId, setRequesterId] = useState(initialDraft.requesterMemberId || '');
    const[knowledgeQuery,setKnowledgeQuery]=useState(initialDraft.subject||'');
    const [organizationRequest,setOrganizationRequest]=useState<OrganizationRequestValue>(()=>readNewTicketOrganization(scope));
    const changeOrganizationRequest=(value:OrganizationRequestValue)=>{setOrganizationRequest(value);writeNewTicketOrganization(scope,value);};
    const attachments = useDraftAttachments(scope, 'request');
    const clients = members.filter(member => member.role === 'client' && member.status !== 'revoked');
    const staff = members.filter(member => member.role !== 'client' && member.status === 'active');
    const requester = clients.find(member => member.id === requesterId);
    return <form className="form" onChange={event => { const values = Object.fromEntries(new FormData(event.currentTarget).entries()); writeNewTicketDraft(scope, Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))); }} onSubmit={e => { e.preventDefault(); if (!attachments.canSubmit) return; const form = new FormData(e.currentTarget); const body: Record<string, unknown> = Object.fromEntries(form.entries()); if (body.assigneeMemberId === '__auto__') delete body.assigneeMemberId; else body.assigneeMemberId = body.assigneeMemberId || null; if (requesterId) body.requesterMemberId = requesterId; else delete body.requesterMemberId; Object.assign(body, attachments.payload()); if(organizationRequest.requestTypeId||Object.keys(organizationRequest.fieldValues||{}).length)Object.assign(body,organizationRequest); const operationId = getDraftOperations().forPayload(scope, body); void onSubmit({ ...body, operationId }).then(ok => { if (ok) { attachments.complete(); clearNewTicketDraft(scope); getDraftOperations().clear(scope); } }); }}>
      <p className="form-intro">Vincula la cuenta del cliente para que pueda consultar y responder este ticket en su portal.</p>
      <div className="form-grid">
        <label className="full">Cuenta del cliente<select name="requesterMemberId" value={requesterId} disabled={busy} onChange={e => {setRequesterId(e.target.value);changeOrganizationRequest({});}}><option value="">Registrar sin cuenta vinculada</option>{clients.map(member => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select></label>
        {requester ? <div className="full staff-account-preview"><strong>{requester.name}</strong>{requester.email} · {requester.status === 'invited' ? 'Podrá entrar cuando acepte su invitación.' : 'Podrá consultar la conversación desde su portal.'}</div> : <><label>Nombre del solicitante<input name="requesterName" defaultValue={initialDraft.requesterName} required maxLength={120} placeholder="Ej. Andrea Molina" disabled={busy}/></label><label>Correo electrónico<input name="requesterEmail" defaultValue={initialDraft.requesterEmail} type="email" required maxLength={254} placeholder="andrea@empresa.com" disabled={busy}/></label></>}
        <label className="full">Asunto<input name="subject" defaultValue={initialDraft.subject} onChange={event=>setKnowledgeQuery(event.target.value)} required maxLength={160} placeholder="Resume la solicitud en una frase" disabled={busy} autoFocus/></label>
        <label>Departamento<select name="department" defaultValue={initialDraft.department} disabled={busy}>{settings.departments.map(department => <option key={department}>{department}</option>)}</select></label>
        <label>Prioridad<select name="priority" defaultValue={initialDraft.priority || 'normal'} disabled={busy}>{Object.entries(PRIORITY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="full">Responsable<select name="assigneeMemberId" defaultValue={initialDraft.assigneeMemberId ?? '__auto__'} disabled={busy}><option value="__auto__">Automático según reglas</option><option value="">Sin asignar (manual)</option>{staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <label className="full">Descripción<textarea name="body" defaultValue={initialDraft.body} required maxLength={20000} rows={5} placeholder="¿Qué está pasando? Añade el contexto necesario para ayudar." disabled={busy}/></label>
      </div>
      {knowledgeEnabled&&<KnowledgeSuggestions key={`${viewer.id}:${viewer.role}`} memberId={viewer.id} query={knowledgeQuery}/>}
      {organizationEnabled&&<RequestOrganizationFields key={`${viewer.id}:${requester?.customerCompanyId||'none'}`} memberId={viewer.id} companyId={requester?.customerCompanyId} staff value={organizationRequest} onChange={changeOrganizationRequest} disabled={busy}/>}
      <AttachmentComposer controls={attachments} disabled={busy}/>
      <div className="form-footer"><button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancelar</button><button disabled={busy || !attachments.canSubmit} className="primary"><Plus size={16}/>Crear ticket</button></div>
    </form>;
}
