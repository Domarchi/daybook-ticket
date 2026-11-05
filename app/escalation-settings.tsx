'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, LoaderCircle, RefreshCw } from 'lucide-react';
import type { Member } from '@/lib/types';
import type { EscalationPolicy } from '@/lib/escalation-policy';
import './satisfaction.css';

export function EscalationSettingsPanel({ memberId, members }: { memberId: string; members: Member[] }) {
  const [policy, setPolicy] = useState<EscalationPolicy | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false);
  const saving = useRef(false), mounted = useRef(false), readRevision = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const version = ++readRevision.current;
    const controller = new AbortController();
    void fetch('/api/escalations', { cache: 'no-store', headers: { 'X-Daybook-Member-Id': memberId }, signal: controller.signal })
      .then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error || 'No se pudo consultar el escalamiento.'); if (!controller.signal.aborted && readRevision.current === version) { setPolicy(value); setError(''); } })
      .catch(failure => { if (!controller.signal.aborted && readRevision.current === version) setError(failure instanceof Error ? failure.message : 'No se pudo consultar el escalamiento.'); });
    return () => { controller.abort(); mounted.current = false; };
  }, [memberId, revision]);
  const staff = members.filter(member => member.status === 'active' && member.hasAccount && ['owner', 'admin', 'agent'].includes(member.role));
  const save = async () => {
    if (!policy || saving.current) return;
    ++readRevision.current;
    saving.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const { activatedAt: _activated, ...body } = policy;
      void _activated;
      const response = await fetch('/api/escalations', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Daybook-Member-Id': memberId }, body: JSON.stringify(body) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'No se pudo guardar el escalamiento.');
      if (mounted.current) { setPolicy(value); setNotice('Configuración de escalamiento guardada.'); }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'No se pudo guardar.'); }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className="panel service-plus-panel" aria-labelledby="escalation-title">
    <div className="section-head"><h2 id="escalation-title"><ArrowUpRight size={18}/>Escalamiento entre encargados</h2><span className={`access-status ${policy?.enabled ? 'active' : 'invited'}`}>{policy?.enabled ? 'Activado' : 'En pausa'}</span></div>
    <div className="service-plus-body">
      <p>Cuando una solicitud necesita apoyo, otro encargado recibe un aviso en el portal y por correo. El responsable del ticket se conserva.</p>
      {!policy && !error && <p role="status"><LoaderCircle className="spinning" size={16}/> Cargando configuración…</p>}
      <fieldset disabled={!policy || busy} className="escalation-fields">
        <label className="service-plus-check"><input type="checkbox" checked={policy?.enabled || false} onChange={event => setPolicy(value => value && ({ ...value, enabled: event.target.checked }))}/>Activar escalamiento automático</label>
        <div className="service-plus-filter-row"><label>Sin respuesta pública del equipo<input type="number" min={120} max={43200} value={policy?.unansweredMinutes ?? 240} onChange={event => setPolicy(value => value && ({ ...value, unansweredMinutes: Number(event.target.value) }))}/><small>Minutos corridos desde el primer mensaje pendiente. Mínimo 120.</small></label><label>Después del vencimiento<input type="number" min={0} max={43200} value={policy?.overdueMinutes ?? 60} onChange={event => setPolicy(value => value && ({ ...value, overdueMinutes: Number(event.target.value) }))}/><small>Minutos corridos desde el plazo de resolución.</small></label></div>
        <div className="escalation-recipients"><strong>Encargados que pueden prestar apoyo</strong><p>Reciben el aviso los seleccionados que estén activos y sean distintos del responsable actual.</p>{staff.length === 0 ? <p>No hay integrantes activos para seleccionar.</p> : staff.map(member => <label className="service-plus-check" key={member.id}><input type="checkbox" checked={policy?.recipientMemberIds.includes(member.id) || false} onChange={event => setPolicy(value => value && ({ ...value, recipientMemberIds: event.target.checked ? [...new Set([...value.recipientMemberIds, member.id])] : value.recipientMemberIds.filter(id => id !== member.id) }))}/><span>{member.name}<small>{member.email}</small></span></label>)}</div>
      </fieldset>
      <p className="service-plus-muted">Funciona las 24 horas con el programador actual. Cada etapa se avisa una vez por destinatario y episodio pendiente. Al activar, los tickets anteriores se incorporan cuando el cliente vuelve a escribir.</p>
      {error && <p className="service-plus-error" role="alert">{error}</p>}{notice && <p className="service-plus-success" role="status">{notice}</p>}
      <div className="service-plus-actions"><button className="secondary" type="button" disabled={busy} onClick={() => { setNotice(''); setRevision(value => value + 1); }}><RefreshCw size={15}/>Actualizar configuración</button><button className="primary" type="button" disabled={!policy || busy || (policy.enabled && !policy.recipientMemberIds.length)} onClick={() => void save()}>{busy && <LoaderCircle size={15} className="spinning"/>}Guardar escalamiento</button></div>
    </div>
  </section>;
}
