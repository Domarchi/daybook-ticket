'use client';
import { workspaceFetch } from '@/lib/workspace-client';

import { useCallback, useEffect, useState } from 'react';
import { Clock, Download, LoaderCircle, ShieldCheck } from 'lucide-react';
import './automatic-backup-panel.css';

interface Status {
  settings: { enabled: boolean; localTime: string; retention: number; storageBudgetMiB: number; version: number; planReviewedAt: string | null; lastErrorCode: string | null; running: boolean };
  configuration: { ready: boolean; reason: string | null; environment: string; maximumArchiveBytes: number; maximumStorageMiB: number; monthlyTransferBudgetMiB: number; monthlyTransferUsedBytes: number };
  runs: { id: string; localDate: string; status: string; attempts: number; sizeBytes: number | null; rowCount: number | null; fileCount: number | null; errorCode: string | null; verifiedAt: string | null; downloadable: boolean }[];
}
const reasons: Record<string, string> = {
  operator_paused: 'La activación privada del servicio está pendiente.', configuration_missing: 'Falta la clave o el almacenamiento privado del ambiente.',
  plan_check_required: 'Hace falta revisar las cuotas del plan antes de activar.', owner_plan_review_required: 'Confirma que revisaste las cuotas antes de activar.',
  monthly_budget_reached: 'Se alcanzó el presupuesto mensual de transferencia. El último respaldo verificado se conserva.',
  storage_budget_reached: 'Se alcanzó el presupuesto de almacenamiento. El último respaldo verificado se conserva.',
  archive_too_large: 'El espacio supera el límite automático de 32 MiB. Usa el respaldo operativo de base y archivos.',
  archive_verification_failed: 'La comprobación del archivo falló. Este intento no se ofrece para recuperación.',
  encryption_key_changed: 'Se necesita la clave privada con la que se creó este respaldo.',
  time_budget_reached: 'El intento agotó su tiempo. Se reintentará con la misma identidad.',
  lease_lost: 'El intento perdió su reserva de ejecución. Se revisará en la próxima pasada.',
  backup_unavailable: 'No se pudo terminar el intento. Se conserva el último respaldo verificado.',
  retention_cleanup_pending: 'La limpieza quedó pendiente; se reintentará sin retirar el último respaldo verificado.',
};
const runLabels: Record<string, string> = { processing: 'Preparando', complete: 'Verificado', failed: 'No completado', deleting: 'Retiro pendiente', deleted: 'Retirado' };
export function AutomaticBackupPanel({ memberId }: { memberId: string }) {
  const [data, setData] = useState<Status | null>(null), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [enabled, setEnabled] = useState(false), [localTime, setLocalTime] = useState('03:00'), [retention, setRetention] = useState(7), [budget, setBudget] = useState(512);
  const headers = useCallback(() => ({ 'X-Daybook-Member-Id': memberId }), [memberId]);
  const apply = useCallback((status: Status) => { setData(status); setEnabled(status.settings.enabled); setLocalTime(status.settings.localTime); setRetention(status.settings.retention); setBudget(status.settings.storageBudgetMiB); }, []);
  const load = useCallback(async () => {
    const response = await workspaceFetch('/api/backups/schedule', { credentials: 'same-origin', cache: 'no-store', headers: headers() });
    const status = await response.json();
    if (!response.ok) throw new Error(status.error || 'No se pudo consultar los respaldos.');
    apply(status);
  }, [headers, apply]);
  useEffect(() => {
    const controller = new AbortController();
    workspaceFetch('/api/backups/schedule', { credentials: 'same-origin', cache: 'no-store', headers: headers(), signal: controller.signal })
      .then(async response => { const status = await response.json(); if (!response.ok) throw new Error(status.error || 'No se pudo consultar los respaldos.'); return status as Status; })
      .then(apply).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No se pudo consultar los respaldos.'); });
    return () => controller.abort();
  }, [headers, apply]);
  return <section className="panel automatic-backup-panel"><div className="section-head"><h2><ShieldCheck size={18}/>Respaldos automáticos cifrados</h2><span>Solo propietario</span></div><div>
    <p>Una copia diaria de la base y los archivos enviados, verificada antes de ofrecerla para recuperación. La clave se conserva en la configuración privada del servicio; guárdala también fuera de Daybook para poder recuperar el espacio.</p>
    {!data && !error && <p role="status"><LoaderCircle size={16} className="spin"/> Consultando respaldos…</p>}
    {data && <><p className="automatic-backup-state" role="status"><Clock size={16}/>{data.settings.running ? 'Hay un respaldo en curso.' : data.settings.enabled && data.configuration.ready ? `Programado a las ${data.settings.localTime}, hora de Santiago.` : 'Los respaldos automáticos están en pausa.'}</p>
      {!data.configuration.ready && <p>{reasons[data.configuration.reason || ''] || 'La configuración privada está pendiente.'}</p>}
      {data.settings.lastErrorCode && <p role="status">{reasons[data.settings.lastErrorCode] || 'Hay un intento pendiente de revisión.'}</p>}
      <form onSubmit={async event => {
        event.preventDefault(); if (busy) return; setBusy(true); setError(''); setMessage('');
        try {
          const response = await workspaceFetch('/api/backups/schedule', { method: 'PATCH', credentials: 'same-origin', cache: 'no-store', headers: { ...headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled, localTime, retention, storageBudgetMiB: budget, version: data.settings.version, planConfirmed: confirmed }) });
          const status = await response.json(); if (!response.ok) throw new Error(status.error || 'No se pudo guardar la programación.');
          apply(status); setConfirmed(false); setMessage(enabled ? 'Programación guardada. La próxima pasada comprobará la hora y los presupuestos.' : 'Programación pausada. Los respaldos guardados se conservan.');
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar.'); } finally { setBusy(false); }
      }}>
        <label className="checkbox-label"><input type="checkbox" checked={enabled} disabled={busy || (!data.configuration.ready && !data.settings.enabled)} onChange={event => setEnabled(event.target.checked)}/>Activar la copia diaria</label>
        <div className="automatic-backup-fields"><label>Hora de Santiago<input type="time" step={1800} required value={localTime} disabled={busy} onChange={event => setLocalTime(event.target.value)}/></label>
          <label>Copias verificadas que conservar<input type="number" min={1} max={14} required value={retention} disabled={busy} onChange={event => setRetention(Number(event.target.value))}/></label>
          <label>Presupuesto de almacenamiento (MiB)<input type="number" min={(retention + 1) * 32} max={1024} required value={budget} disabled={busy} onChange={event => setBudget(Number(event.target.value))}/></label></div>
        <p><small>Hasta 32 MiB por copia. El presupuesto debe cubrir las copias conservadas y una nueva. La ejecución usa el programador existente y puede comenzar hasta media hora después. La hora sigue los cambios de horario de Santiago.</small></p>
        <label className="checkbox-label"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)}/>Revisé las cuotas disponibles del plan, la reserva para otros archivos y la custodia separada de la clave.</label>
        <p><small>Límite privado: {data.configuration.maximumStorageMiB || 'pendiente'} MiB de almacenamiento y {data.configuration.monthlyTransferBudgetMiB || 'pendiente'} MiB de transferencia al mes. Reservado este mes: {Math.ceil(data.configuration.monthlyTransferUsedBytes / 1048576)} MiB. Ningún ajuste cambia el plan contratado.</small></p>
        <button type="submit" className="primary" disabled={busy || (enabled && (!confirmed || !data.configuration.ready))}>{busy && <LoaderCircle size={16} className="spin"/>}Guardar programación</button>
      </form>
      <div className="automatic-backup-history"><h3>Últimos intentos</h3>{!data.runs.length ? <p>Aún no hay respaldos automáticos.</p> : <ul>{data.runs.map(run => <li key={run.id}><div><strong>{run.localDate}</strong><span>{runLabels[run.status] || run.status}{run.sizeBytes ? ` · ${(run.sizeBytes / 1048576).toFixed(1)} MiB` : ''}</span>{run.verifiedAt && <small>{run.rowCount} registros · {run.fileCount} archivos · integridad comprobada</small>}{run.errorCode && <small>{reasons[run.errorCode] || 'Se conservaron los datos y el último respaldo verificado.'}</small>}</div>
        {run.downloadable && <button type="button" disabled={busy} onClick={async () => {
          setBusy(true); setError(''); try {
            const response = await workspaceFetch(`/api/backups/schedule/${encodeURIComponent(run.id)}/download`, { credentials: 'same-origin', cache: 'no-store', headers: headers() });
            if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || 'No se pudo descargar el respaldo.'); }
            const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement('a');
            link.href = url; link.download = `daybook-automatico-${run.localDate}.daybook`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
          } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo descargar.'); } finally { setBusy(false); }
        }}><Download size={16}/>Descargar cifrado</button>}</li>)}</ul>}</div>
      <button type="button" disabled={busy} onClick={() => { setError(''); load().catch(reason => setError(reason instanceof Error ? reason.message : 'No se pudo actualizar.')); }}>Actualizar estado</button>
    </>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </div></section>;
}
