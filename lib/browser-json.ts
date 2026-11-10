export class BrowserJsonError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown = null,
  ) {
    super(message);
    this.name = 'BrowserJsonError';
  }
}
export const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
export interface BrowserJsonContract<T> {
  validate: (value: unknown) => value is T;
  mutation?: boolean;
}
const invalidSuccess = (mutation: boolean) =>
  mutation
    ? 'No se pudo confirmar el resultado. La información de esta pantalla se conserva. Revisa el resultado y vuelve a intentarlo.'
    : 'No se pudo leer una respuesta válida de Daybook. Vuelve a intentarlo.';
const httpFailure = (status: number) =>
  status === 401
    ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
    : status === 403
      ? 'Ya no tienes acceso a esta operación.'
      : status === 428
        ? 'Verifica nuevamente tu acceso para continuar.'
        : status === 429
          ? 'Hay demasiadas solicitudes. Espera un momento y vuelve a intentarlo.'
          : 'No se pudo completar la operación. Vuelve a intentarlo.';

/** Reads JSON exactly once and confirms success only after its declared DTO contract passes.
 * Transport stays with the caller (daybookFetch/workspaceFetch). No retry or redirect occurs here.
 * HTTP errors retain status/payload for MFA/re-auth flows, including 428. JSON/empty/204/malformed
 * successes are rejected; callers must not clear a draft or operationId before this resolves.
 */
export async function readDaybookJson<T>(response: Response, contract: BrowserJsonContract<T>): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new BrowserJsonError(
      response.ok ? invalidSuccess(contract.mutation === true) : httpFailure(response.status),
      response.status,
    );
  }
  if (!response.ok)
    throw new BrowserJsonError(
      isJsonObject(payload) && typeof payload.error === 'string' && payload.error.trim()
        ? payload.error
        : httpFailure(response.status),
      response.status,
      payload,
    );
  let valid = false;
  try {
    valid = contract.validate(payload);
  } catch {
    /* Invalid DTOs never become confirmed mutations. */
  }
  if (!valid) throw new BrowserJsonError(invalidSuccess(contract.mutation === true), response.status);
  return payload as T;
}
