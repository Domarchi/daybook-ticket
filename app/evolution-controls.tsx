'use client';
import { readDaybookJson } from '@/lib/browser-json';
import { domainResponseValidator } from '@/lib/domain-response';
import { daybookFetch } from '@/lib/browser-request';
import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { readTicketResource } from '@/hooks/use-ticket-search';
import { EVOLUTION_FEATURES, type EvolutionFeatures } from '@/lib/evolution-feature-model';

type Theme = 'system' | 'light' | 'dark';
export function ThemeBootstrap() {
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      if (!document.documentElement.dataset.theme || document.documentElement.dataset.theme === 'system')
        document.documentElement.dataset.colorScheme = query.matches ? 'dark' : 'light';
    };
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);
  return null;
}
export function ThemeControl({ memberId, preferred }: { memberId: string; preferred: Theme }) {
  const [theme, setTheme] = useState<Theme>(preferred),
    [error, setError] = useState('');
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.colorScheme = theme === 'system' ? (query.matches ? 'dark' : 'light') : theme;
    };
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [theme]);
  return (
    <div className="theme-control">
      {theme === 'system' ? <Monitor size={15} /> : theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
      <select
        aria-label="Apariencia"
        value={theme}
        onChange={async event => {
          const next = event.target.value as Theme;
          setTheme(next);
          setError('');
          try {
            const response = await daybookFetch('/api/preferences', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'X-Daybook-Member-Id': memberId },
              body: JSON.stringify({ theme: next }),
            });
            await readDaybookJson(response, {
              mutation: true,
              validate: domainResponseValidator('/api/preferences', 'PUT'),
            });
          } catch {
            setError('La apariencia se aplicó en esta página, pero no pudo guardarse en tu cuenta.');
          }
        }}
      >
        <option value="system">Automático</option>
        <option value="dark">Oscuro</option>
        <option value="light">Claro</option>
      </select>
      {error && <span role="status">{error}</span>}
    </div>
  );
}
const labels: Record<keyof EvolutionFeatures, string> = {
  collaboration: 'Conversaciones colaborativas',
  organization: 'Organización de tickets',
  serviceContext: 'Equipos y contratos',
  automation: 'Reglas de trabajo',
  knowledge: 'Conocimiento e informes',
  security: 'Centro de seguridad',
  workspaces: 'Espacios comerciales',
};
export function EvolutionFeaturesPanel({
  memberId,
  onChanged,
}: {
  memberId: string;
  onChanged?: () => Promise<unknown> | void;
}) {
  const [state, setState] = useState<{ features: EvolutionFeatures; version: number; available: boolean } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void readTicketResource<NonNullable<typeof state>>('/api/evolution/features', memberId, controller.signal)
      .then(value => {
        if (!controller.signal.aborted) setState(value);
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No se pudo consultar.');
      });
    return () => controller.abort();
  }, [memberId]);
  return (
    <section className="panel evolution-features-panel">
      <div className="section-head">
        <h2>Funciones del espacio</h2>
      </div>
      <p>
        Activa o pausa partes de Daybook en este espacio. Pausar una función conserva sus datos y se puede volver a
        activar. La obligación de doble factor se administra por separado, en Seguridad.
      </p>
      {error && <p role="alert">{error}</p>}
      {!state ? (
        <p role="status">Consultando funciones…</p>
      ) : !state.available ? (
        <p role="status">
          Estas funciones aún no están disponibles en este espacio: falta una actualización de la base de datos que hace
          el equipo técnico de Daybook.
        </p>
      ) : (
        <div>
          {EVOLUTION_FEATURES.map(feature => (
            <label key={feature}>
              <span>{labels[feature]}</span>
              <input
                type="checkbox"
                checked={state.features[feature]}
                disabled={busy}
                onChange={async event => {
                  setBusy(true);
                  setError('');
                  try {
                    const response = await daybookFetch('/api/evolution/features', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json', 'X-Daybook-Member-Id': memberId },
                      body: JSON.stringify({
                        expectedVersion: state.version,
                        features: { [feature]: event.target.checked },
                      }),
                    });
                    const value = await readDaybookJson(response, {
                      mutation: true,
                      validate: domainResponseValidator<typeof state>('/api/evolution/features', 'PATCH'),
                    });
                    setState(value);
                    try {
                      await onChanged?.();
                    } catch {
                      setError('La configuración se guardó. Actualiza la página para verla.');
                    }
                  } catch (reason) {
                    setError(reason instanceof Error ? reason.message : 'No se pudo guardar.');
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
