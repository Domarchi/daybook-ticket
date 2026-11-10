'use client';
import { daybookFetch } from '@/lib/browser-request';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing, CheckCircle2, Clock3, LoaderCircle, RefreshCw } from 'lucide-react';
import './notification-settings.css';

type Health = {
  configured?: boolean;
  enabled?: boolean;
  stale?: boolean;
  lastSucceededAt?: string | null;
  lastStartedAt?: string | null;
  lastFailedAt?: string | null;
  lastErrorCode?: string | null;
};
type State = { config: { remindersEnabled: boolean; remindersActivatedAt: string | null }; health: Health };
const date = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat('es-CL', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'America/Santiago',
      }).format(new Date(value))
    : 'Aún no registrada';

async function readSettings(enabled?: boolean): Promise<State> {
  const response = await daybookFetch('/api/notifications/settings', {
    method: enabled === undefined ? 'GET' : 'PATCH',
    cache: 'no-store',
    ...(enabled === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No se pudo consultar la configuración de avisos.');
  return result;
}

export function NotificationSettingsPanel() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0),
    mounted = useRef(false),
    writing = useRef(false);
  const refresh = useCallback(async () => {
    if (writing.current) return;
    const version = ++revision.current;
    try {
      const next = await readSettings();
      if (mounted.current && revision.current === version) {
        setState(next);
        setError('');
      }
    } catch (failure) {
      if (mounted.current && revision.current === version)
        setError(failure instanceof Error ? failure.message : 'No se pudo actualizar.');
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const version = ++revision.current;
    void readSettings()
      .then(next => {
        if (mounted.current && revision.current === version) {
          setState(next);
          setError('');
        }
      })
      .catch(failure => {
        if (mounted.current && revision.current === version)
          setError(failure instanceof Error ? failure.message : 'No se pudo actualizar.');
      });
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30_000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  const toggle = async () => {
    if (!state || writing.current) return;
    writing.current = true;
    const version = ++revision.current;
    setBusy(true);
    setError('');
    try {
      const next = await readSettings(!state.config.remindersEnabled);
      if (mounted.current && revision.current === version) setState(next);
    } catch (failure) {
      if (mounted.current && revision.current === version)
        setError(failure instanceof Error ? failure.message : 'No se pudo guardar.');
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const enabled = Boolean(state?.config.remindersEnabled);
  const healthy = state?.health.lastSucceededAt && !state.health.stale;
  return (
    <section className="panel notification-settings" aria-labelledby="reminder-settings-title">
      <div className="section-head">
        <h2 id="reminder-settings-title">
          <BellRing size={18} />
          Recordatorios del equipo
        </h2>
        <span className={`access-status ${enabled ? 'active' : 'invited'}`}>{enabled ? 'Activados' : 'En pausa'}</span>
      </div>
      <div className="notification-settings-body">
        <p>Una ayuda para atender a tiempo, incluso cuando nadie tiene el portal abierto.</p>
        <div className="reminder-rules">
          <div>
            <strong>2 horas</strong>
            <span>Sin respuesta al cliente</span>
          </div>
          <div>
            <strong>1 hora antes</strong>
            <span>Del vencimiento</span>
          </div>
          <div>
            <strong>24 horas</strong>
            <span>Entre repeticiones</span>
          </div>
        </div>
        <p className="reminder-routing">
          Los avisos llegan al responsable del ticket; si no hay uno activo, a los encargados configurados. Funcionan
          todos los días, las 24 horas, con revisiones cada 30 minutos.
        </p>
        <div className="reminder-health">
          <span className={healthy ? 'reminder-health-icon healthy' : 'reminder-health-icon'}>
            {healthy ? <CheckCircle2 size={18} /> : <Clock3 size={18} />}
          </span>
          <div>
            <strong>Última revisión completada</strong>
            <span>{date(state?.health.lastSucceededAt)}</span>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Actualizar estado de recordatorios"
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} />
          </button>
        </div>
        {enabled && state?.health.stale && (
          <p className="notification-settings-warning">
            Hace más de una hora que no se completa una revisión. Comprueba la conexión del programador antes de confiar
            en los recordatorios.
          </p>
        )}
        {enabled && state?.health.configured === false && (
          <p className="notification-settings-warning">
            Los recordatorios están preparados; falta conectar el programador para que se ejecuten automáticamente.
          </p>
        )}
        {error && (
          <p role="alert" className="notification-settings-error">
            {error}
          </p>
        )}
        <div className="notification-settings-footer">
          <small>
            {enabled
              ? 'Cada etapa genera un aviso. Los motivos coincidentes se agrupan; luego se repite como máximo una vez cada 24 horas.'
              : 'Al activar, los tickets existentes se incorporarán cuando el cliente vuelva a escribir. No se enviarán recordatorios históricos.'}
          </small>
          <button
            className={enabled ? 'secondary' : 'primary'}
            type="button"
            disabled={!state || busy}
            onClick={() => void toggle()}
          >
            {busy && <LoaderCircle size={15} className="spinning" />}
            {enabled ? 'Pausar recordatorios' : 'Activar recordatorios'}
          </button>
        </div>
      </div>
    </section>
  );
}
