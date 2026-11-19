'use client';
import { readDaybookJson } from '@/lib/browser-json';
import { domainResponseValidator } from '@/lib/domain-response';
import { daybookFetch } from '@/lib/browser-request';
import { useEffect, useState } from 'react';
import { Contrast, Monitor, Moon, Sun } from 'lucide-react';
import { readTicketResource } from '@/hooks/use-ticket-search';
import { EVOLUTION_FEATURES, type EvolutionFeatures } from '@/lib/evolution-feature-model';
import { SkeletonList } from './estados';

type Theme = 'system' | 'light' | 'dark';
export function ThemeBootstrap() {
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    // `data-theme` lleva el tema que se ve (claro u oscuro), igual que Parte Diario
    // y Travel; la preferencia elegida (incluido «sistema») va en
    // `data-theme-preference`. Sin preferencia explícita se sigue al sistema.
    const apply = () => {
      const root = document.documentElement;
      if (!root.dataset.themePreference || root.dataset.themePreference === 'system')
        root.dataset.theme = query.matches ? 'dark' : 'light';
    };
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);
  return null;
}
export type ThemePreference = Theme;
const THEME_LABELS: Record<Theme, string> = { system: 'Sistema', light: 'Claro', dark: 'Oscuro' };
const THEME_ICONS: Record<Theme, typeof Sun> = { system: Contrast, light: Sun, dark: Moon };
/** Las tres opciones de Configuración › Apariencia, en el orden de Parte Diario. */
export const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
  { value: 'system', label: 'Según el sistema' },
];
/** El botón del riel recorre Sistema → Claro → Oscuro, como el de Parte Diario. */
export function nextTheme(theme: Theme): Theme {
  return theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
}

/**
 * El tema de la persona: lo aplica a <html> y lo guarda en su cuenta (PUT /api/preferences). Lo usan el botón
 * del pie del riel y Configuración › Apariencia, que muestran la misma elección. Mientras el tema cambia,
 * `db-theme-switching` (@daybook/design riel.css) apaga las transiciones para que el riel no parpadee; se
 * saca al cuadro siguiente. Sin `memberId` (la cuenta todavía no cargó) no toca nada: manda ThemeBootstrap.
 */
export function useThemePreference(memberId: string | undefined, preferred: Theme) {
  const [state, setState] = useState({ memberId, theme: preferred, error: '' });
  // Otra persona (o la primera carga): parte de lo que tiene guardado.
  if (state.memberId !== memberId) setState({ memberId, theme: preferred, error: '' });
  const theme = state.memberId === memberId ? state.theme : preferred;
  useEffect(() => {
    if (!memberId) return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const root = document.documentElement;
    let frame = 0;
    const apply = () => {
      root.classList.add('db-theme-switching');
      root.dataset.themePreference = theme;
      root.dataset.theme = theme === 'system' ? (query.matches ? 'dark' : 'light') : theme;
      // El estilo se calcula ya, con las transiciones apagadas; al cuadro siguiente vuelven.
      void getComputedStyle(root).backgroundColor;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => root.classList.remove('db-theme-switching'));
    };
    apply();
    query.addEventListener('change', apply);
    return () => {
      query.removeEventListener('change', apply);
      cancelAnimationFrame(frame);
      root.classList.remove('db-theme-switching');
    };
  }, [memberId, theme]);
  const choose = async (next: Theme) => {
    setState(current => ({ ...current, theme: next, error: '' }));
    if (!memberId) return;
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
      setState(current => ({
        ...current,
        error: 'La apariencia se aplicó en esta página, pero no pudo guardarse en tu cuenta.',
      }));
    }
  };
  return { theme, error: state.error, choose };
}

/** El tema en el portal del cliente: un selector. */
export function ThemeControl({ memberId, preferred }: { memberId: string; preferred: Theme }) {
  const { theme, error, choose } = useThemePreference(memberId, preferred);
  return (
    <div className="theme-control">
      {theme === 'system' ? <Monitor size={15} /> : theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
      <select aria-label="Apariencia" value={theme} onChange={event => void choose(event.target.value as Theme)}>
        <option value="system">Sistema</option>
        <option value="light">Claro</option>
        <option value="dark">Oscuro</option>
      </select>
      {error && <span role="status">{error}</span>}
    </div>
  );
}

/**
 * El tema en el pie del riel, igual que MenuTema de Parte Diario: un botón de 44 px con el ícono de lo elegido
 * que pasa a la opción siguiente. El nombre lo dice («Tema: Claro»); el título, a qué cambia. El ícono lleva
 * key por la elección, así entra con el fundido de riel.css cada vez que cambia.
 */
export function ThemeCycleButton({ theme, onChoose }: { theme: Theme; onChoose: (theme: Theme) => void }) {
  const next = nextTheme(theme);
  const Icon = THEME_ICONS[theme];
  return (
    <button
      type="button"
      className="db-rail-icon-button"
      aria-label={`Tema: ${THEME_LABELS[theme]}`}
      title={`Cambiar a ${THEME_LABELS[next]}`}
      onClick={() => onChoose(next)}
    >
      <Icon key={theme} aria-hidden="true" />
    </button>
  );
}

/**
 * Configuración › Apariencia: radios de verdad dentro de un fieldset, pintados como control segmentado (como en
 * Parte Diario). Una sola elegida, las flechas recorren las tres y el lector anuncia «Tema, Oscuro, 2 de 3».
 */
export function ThemeChoice({ theme, onChoose }: { theme: Theme; onChoose: (theme: Theme) => void }) {
  return (
    <fieldset className="theme-choice">
      <legend>Tema</legend>
      <div className="theme-options">
        {THEME_OPTIONS.map(option => {
          const Icon = THEME_ICONS[option.value];
          return (
            <label key={option.value}>
              <input
                type="radio"
                name="tema"
                value={option.value}
                checked={theme === option.value}
                onChange={() => onChoose(option.value)}
              />
              <span>
                <Icon size={18} aria-hidden="true" />
                {option.label}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
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
        <SkeletonList label="Consultando funciones…" rows={2} lines={1} />
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
