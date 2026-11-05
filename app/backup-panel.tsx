'use client';
import { useState } from 'react';
import { Download, ShieldCheck, LoaderCircle } from 'lucide-react';
export function BackupPanel({ memberId }: { memberId: string }) {
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState('');
  return <section className="panel backup-panel"><div className="section-head"><h2><ShieldCheck size={18}/>Respaldo de la plataforma Daybook</h2><span>Solo propietario de plataforma</span></div><div>
    <p>Respaldo operativo con cuentas de acceso y datos privados de Daybook, reservado al propietario de la plataforma. Para compartir o trasladar datos de un negocio usa su exportación privada desde Seguridad. Verifica tu identidad antes de crear el respaldo.</p><p>Conserva por separado la clave de este archivo y la clave original de autenticación de la plataforma. Los autenticadores se recuperan únicamente con esa configuración privada, nunca desactivándolos automáticamente.</p>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy || !accepted || password.length < 16 || password !== confirmation) return;
      setBusy(true); setError(''); setResult('');
      try {
        const response = await fetch('/api/backups', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Daybook-Member-Id': memberId }, body: JSON.stringify({ password, confirmation: 'RESPALDAR' }) });
        if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'No se pudo completar el respaldo.'); }
        const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = `daybook-${new Date().toISOString().slice(0, 10)}.daybook`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        setResult(`Respaldo descargado: ${response.headers.get('X-Daybook-Backup-Rows') || '—'} registros y ${response.headers.get('X-Daybook-Backup-Files') || '—'} archivos. Conserva el archivo y su clave. La recuperación se realiza en un destino vacío siguiendo el procedimiento privado.`);
        setPassword(''); setConfirmation(''); setAccepted(false);
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo completar el respaldo.'); }
      finally { setBusy(false); }
    }}>
      <label>Clave de respaldo<input type="password" autoComplete="new-password" required minLength={16} maxLength={256} disabled={busy} value={password} onChange={event => setPassword(event.target.value)}/><small>Al menos 16 caracteres. Se usa solo para cifrar esta descarga.</small></label>
      <label>Repetir clave<input type="password" autoComplete="new-password" required minLength={16} maxLength={256} disabled={busy} value={confirmation} onChange={event => setConfirmation(event.target.value)}/></label>
      <label className="checkbox-label"><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)}/>Guardaré la clave y protegeré este archivo, que incluye datos privados y cuentas.</label>
      <button type="submit" className="primary" disabled={busy || !accepted || password.length < 16 || password !== confirmation}>{busy ? <LoaderCircle size={16} className="spin"/> : <Download size={16}/>} {busy ? 'Preparando respaldo…' : 'Descargar respaldo cifrado'}</button>
    </form>{error && <p role="alert">{error}</p>}{result && <p className="backup-result" role="status">{result}</p>}
    <p><small>Límite inicial: 100.000 registros, 24 MiB de datos y 128 MiB por archivo de respaldo. Las sesiones, tokens temporales y adjuntos de borradores requieren una nueva activación o carga tras recuperar.</small></p>
  </div></section>;
}
