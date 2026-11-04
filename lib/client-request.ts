export class ClientRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export async function clientRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : 'No se pudo completar la operación. Intenta nuevamente.';
    throw new ClientRequestError(message, response.status);
  }
  return value as T;
}
