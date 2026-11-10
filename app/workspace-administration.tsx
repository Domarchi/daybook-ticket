'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { workspaceApiPath, workspaceHome, DEFAULT_PILOT_LIMITS, limitsSchema } from '@/lib/workspace-model';
import { daybookFetch } from '@/lib/browser-request';
import { readDaybookJson, isJsonObject } from '@/lib/browser-json';
import {
  MEGABYTE,
  WORKSPACE_LIMIT_FIELDS as LIMIT_FIELDS,
  workspaceStateLabel as stateLabel,
  workspaceQuotaValue as quotaValue,
  workspaceStorageMegabytesInput,
  readWorkspaceLimits as readLimits,
  isEvolutionFeaturesResponse,
} from '@/lib/workspace-administration-ui';
import './workspaces.css';
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await daybookFetch(path, {
    method,
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return readDaybookJson(response, {
    mutation: method !== 'GET',
    validate: (value): value is T => {
      if (!isJsonObject(value)) return false;
      if (path.endsWith('/evolution/features') && (method === 'GET' || method === 'PATCH'))
        return isEvolutionFeaturesResponse(value);
      if (method === 'GET')
        return path.endsWith('/administration')
          ? ['ownerReady', 'securityRequired', 'mailVerified', 'canConfigure'].every(
              key => typeof value[key] === 'boolean',
            )
          : Array.isArray(value.workspaces);
      if (method === 'PATCH') return value.updated === true || value.transferred === true;
      return (
        typeof value.invitationUrl === 'string' &&
        (path === '/api/operator/workspaces' ? typeof value.workspaceId === 'string' && value.state === 'draft' : true)
      );
    },
  });
}
type Profile = {
  workspaceId: string;
  state: string;
  brandName: string;
  mailFrom: string | null;
  mailEnabled: boolean;
  inboundEnabled: boolean;
  version: number;
  limits: Record<string, number>;
};
type Onboarding = {
  profile: Profile | null;
  ownerReady: boolean;
  securityRequired: boolean;
  mailVerified: boolean;
  canConfigure: boolean;
};
function QuotaFields({ limits, disabled }: { limits: Record<string, number>; disabled: boolean }) {
  return (
    <fieldset className="commercial-limit-fields" disabled={disabled}>
      <legend>Límites acordados</legend>
      <p>Define la capacidad de este negocio. Los cambios se revisan antes de guardar.</p>
      <div className="commercial-limit-grid">
        {LIMIT_FIELDS.map(({ key, label, description }) => {
          const storage = key === 'storageBytes',
            factor = storage ? MEGABYTE : 1,
            min = (limitsSchema.shape[key].minValue ?? 1) / factor,
            max = (limitsSchema.shape[key].maxValue ?? 1) / factor;
          return (
            <label key={key}>
              {label}
              {storage ? ' (MB)' : ''}
              <input
                name={storage ? 'storageMegabytes' : key}
                type="number"
                inputMode={storage ? 'decimal' : 'numeric'}
                min={min}
                max={max}
                step={storage ? 'any' : 1}
                required
                defaultValue={storage ? workspaceStorageMegabytesInput(limits[key]) : limits[key]}
              />
              <small>
                {description} De {min.toLocaleString('es-CL')} a {max.toLocaleString('es-CL')}
                {storage ? ' MB' : ''}.
              </small>
            </label>
          );
        })}
      </div>
      <small>1 MB equivale a {MEGABYTE.toLocaleString('es-CL')} bytes. Los límites mensuales se cuentan en UTC.</small>
    </fieldset>
  );
}
function QuotaSummary({
  limits,
  usage,
}: {
  limits: Record<string, number>;
  usage?: Partial<Record<(typeof LIMIT_FIELDS)[number]['key'], number | string>>;
}) {
  return (
    <dl className="commercial-quota-summary">
      {LIMIT_FIELDS.map(({ key, label }) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>
            {usage ? `${quotaValue(key, usage[key] ?? 0)} / ` : ''}
            {quotaValue(key, limits[key])}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function WorkspaceAdministrationPanel({
  workspaceId,
  onChanged,
}: {
  workspaceId: string;
  onChanged?: () => Promise<unknown> | void;
}) {
  const [data, setData] = useState<Onboarding | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const path = workspaceApiPath('/api/administration', workspaceId),
    load = useCallback(async () => setData(await request<Onboarding>(path)), [path]);
  useEffect(() => {
    let live = true;
    void request<Onboarding>(path)
      .then(value => {
        if (live) setData(value);
      })
      .catch(reason => {
        if (live) setError(reason.message);
      });
    return () => {
      live = false;
    };
  }, [path]);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      await load();
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel commercial-panel">
      <div className="section-head">
        <h2>Incorporación del negocio</h2>
        <button className="text-button" disabled={busy} onClick={() => void run(load)}>
          Actualizar
        </button>
      </div>
      <div className="commercial-body">
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {!data && !error && <p role="status">Consultando preparación…</p>}
        {data && (
          <>
            <ul>
              <li>Propietario con autenticador y recuperación: {data.ownerReady ? 'Preparado' : 'Pendiente'}</li>
              <li>Doble factor obligatorio para el equipo: {data.securityRequired ? 'Activado' : 'Pendiente'}</li>
              <li>Correo verificado: {data.mailVerified ? 'Preparado' : 'Pendiente de comprobación del operador'}</li>
              <li>Estado: {data.profile ? stateLabel(data.profile.state) : 'Daybook existente'}</li>
            </ul>
            <p>
              Activa y comprueba tu autenticador personalmente. El operador habilitará el piloto cuando hayas terminado
              la preparación y revisado sus límites.
            </p>
            <Link className="secondary" href={workspaceId === 'daybook' ? '/security' : `/w/${workspaceId}/security`}>
              Configurar seguridad
            </Link>
            {data.profile && data.canConfigure && (
              <>
                <button
                  className="secondary"
                  disabled={busy || !data.ownerReady || !data.securityRequired}
                  onClick={() =>
                    void run(async () => {
                      const path = workspaceApiPath('/api/evolution/features', workspaceId),
                        current = await request<{ version: number }>(path);
                      await request(path, 'PATCH', {
                        expectedVersion: current.version,
                        features: { security: true, workspaces: true },
                      });
                      setNotice('Seguridad y espacios preparados. El operador puede revisar la activación.');
                    })
                  }
                >
                  Preparar funciones del piloto
                </button>
                <form
                  key={data.profile.version}
                  onSubmit={event => {
                    event.preventDefault();
                    const fields = new FormData(event.currentTarget);
                    void run(async () => {
                      await request(path, 'PATCH', {
                        action: 'configure',
                        brandName: fields.get('brandName'),
                        mailFrom: String(fields.get('mailFrom') || '').trim() || null,
                        mailEnabled: fields.get('mailEnabled') === 'on',
                        inboundEnabled: fields.get('inboundEnabled') === 'on',
                        expectedVersion: data.profile!.version,
                      });
                      setNotice('Configuración guardada.');
                    });
                  }}
                >
                  <label>
                    Marca del negocio
                    <input name="brandName" maxLength={120} required defaultValue={data.profile.brandName} />
                  </label>
                  <label>
                    Remitente autorizado
                    <input
                      name="mailFrom"
                      maxLength={200}
                      defaultValue={data.profile.mailFrom || ''}
                      placeholder="Soporte Empresa <soporte@empresa.cl>"
                    />
                  </label>
                  <small>
                    El remitente debe estar verificado en el proveedor y autorizado en la configuración privada por el
                    operador. No se cambia DNS ni se crean proveedores desde aquí.
                  </small>
                  <label>
                    <input name="mailEnabled" type="checkbox" defaultChecked={data.profile.mailEnabled} />
                    Envíos automáticos
                  </label>
                  <label>
                    <input name="inboundEnabled" type="checkbox" defaultChecked={data.profile.inboundEnabled} />
                    Recepción de correo
                  </label>
                  <button className="primary" disabled={busy}>
                    Guardar configuración
                  </button>
                </form>
                <details>
                  <summary>Límites acordados del piloto</summary>
                  <QuotaSummary limits={data.profile.limits} />
                </details>
                <details>
                  <summary>Transferir el rol de propietario</summary>
                  <form
                    onSubmit={event => {
                      event.preventDefault();
                      const fields = new FormData(event.currentTarget);
                      void run(async () => {
                        await request(path, 'PATCH', { action: 'transfer_owner', memberId: fields.get('memberId') });
                        window.location.reload();
                      });
                    }}
                  >
                    <p>
                      La cuenta destinataria debe pertenecer al equipo activo y tener autenticador y recuperación
                      verificados. La clave de aislamiento y los datos conservarán su asociación.
                    </p>
                    <label>
                      Identificador de la cuenta destinataria
                      <input name="memberId" required />
                    </label>
                    <button className="secondary" disabled={busy}>
                      Transferir rol
                    </button>
                  </form>
                </details>
              </>
            )}
            <Link href={workspaceHome(workspaceId)}>Abrir el espacio</Link>
          </>
        )}
      </div>
    </section>
  );
}
type OperatorRow = Profile & {
  members: number;
  ticketsMonthly: number;
  messagesMonthly: number;
  storageBytes: string;
  mailMonthly: number;
  lastJobAt: string | null;
};
export function PlatformOperatorConsole() {
  const [rows, setRows] = useState<OperatorRow[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [invitation, setInvitation] = useState('');
  const [loading, setLoading] = useState(true),
    [loaded, setLoaded] = useState(false),
    [loadError, setLoadError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await request<{ workspaces: OperatorRow[] }>('/api/operator/workspaces');
      setRows(data.workspaces);
      setLoaded(true);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : 'No se pudieron consultar los pilotos.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let live = true;
    void request<{ workspaces: OperatorRow[] }>('/api/operator/workspaces')
      .then(data => {
        if (live) {
          setRows(data.workspaces);
          setLoaded(true);
        }
      })
      .catch(reason => {
        if (live) setLoadError(reason instanceof Error ? reason.message : 'No se pudieron consultar los pilotos.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo completar.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="commercial-panel">
      <h1>Operación Daybook</h1>
      <p>
        Alta manual, estado y consumo de pilotos. Esta consola no concede acceso a tickets, conversaciones, contactos ni
        archivos de los negocios.
      </p>
      <Link href="/account/security">Verificar mi identidad</Link>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section className="panel commercial-body">
        <h2>Invitar un negocio</h2>
        <form
          onSubmit={event => {
            event.preventDefault();
            const form = event.currentTarget,
              fields = new FormData(form);
            void run(async () => {
              const data = await request<{ invitationUrl: string }>('/api/operator/workspaces', 'POST', {
                name: fields.get('name'),
                ownerName: fields.get('ownerName'),
                ownerEmail: fields.get('ownerEmail'),
                limits: readLimits(fields),
              });
              setInvitation(data.invitationUrl);
              form.reset();
            });
          }}
        >
          <label>
            Negocio
            <input name="name" required maxLength={120} />
          </label>
          <label>
            Nombre del propietario
            <input name="ownerName" required maxLength={120} />
          </label>
          <label>
            Correo del propietario
            <input name="ownerEmail" type="email" required maxLength={254} />
          </label>
          <QuotaFields limits={DEFAULT_PILOT_LIMITS} disabled={busy} />
          <button className="primary" disabled={busy}>
            Crear piloto en borrador
          </button>
        </form>
        {invitation && (
          <div>
            <p>
              Comparte este enlace privado con el propietario. El remitente del piloto permanecerá pendiente hasta
              verificarlo.
            </p>
            <a className="commercial-invitation" href={invitation}>
              {invitation}
            </a>
            <button className="text-button" onClick={() => setInvitation('')}>
              Ocultar enlace
            </button>
          </div>
        )}
      </section>
      <section className="panel commercial-body" aria-busy={loading}>
        <h2>Pilotos y capacidad</h2>
        {loading && <p role="status">Consultando pilotos…</p>}
        {loadError && (
          <div role="alert" className="error">
            <p>{loadError}</p>
            <button className="secondary" disabled={busy || loading} onClick={() => void load()}>
              Reintentar
            </button>
          </div>
        )}
        {loaded && !loading && !loadError && !rows.length && <p>Aún no hay negocios piloto.</p>}
        {rows.map(row => (
          <article className="commercial-workspace" key={row.workspaceId}>
            <h3>{row.brandName}</h3>
            <p>
              <span className="commercial-state" data-state={row.state}>
                {stateLabel(row.state)}
              </span>{' '}
              <span className="commercial-workspace-id">{row.workspaceId}</span>
            </p>
            {row.state === 'draft' && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await request<{ invitationUrl: string }>(
                      `/api/operator/workspaces/${row.workspaceId}`,
                      'POST',
                      { action: 'renew_owner_invitation', expectedVersion: row.version },
                    );
                    setInvitation(result.invitationUrl);
                  })
                }
              >
                Renovar acceso inicial del propietario
              </button>
            )}
            <p className="commercial-usage-caption">Uso actual / límite acordado</p>
            <QuotaSummary limits={row.limits} usage={row} />
            <p>
              Última pasada del programador:{' '}
              {row.lastJobAt ? new Date(row.lastJobAt).toLocaleString('es-CL') : 'Pendiente'}
            </p>
            <form
              key={`${row.workspaceId}:${row.version}`}
              onSubmit={event => {
                event.preventDefault();
                const fields = new FormData(event.currentTarget);
                void run(async () => {
                  await request(`/api/operator/workspaces/${row.workspaceId}`, 'PATCH', {
                    state: fields.get('state'),
                    capacityConfirmed: fields.get('capacityConfirmed') === 'on',
                    limits: readLimits(fields),
                    expectedVersion: row.version,
                  });
                });
              }}
            >
              <label>
                Estado
                <select name="state" defaultValue={row.state}>
                  <option value="draft">En preparación</option>
                  <option value="active">Activo</option>
                  <option value="suspended">En pausa</option>
                </select>
              </label>
              <QuotaFields limits={row.limits} disabled={busy} />
              <label>
                <input name="capacityConfirmed" type="checkbox" />
                Revisé la capacidad disponible y los límites acordados, sin contratar servicios.
              </label>
              <button className="secondary" disabled={busy}>
                Revisar y guardar
              </button>
            </form>
          </article>
        ))}
      </section>
    </div>
  );
}
