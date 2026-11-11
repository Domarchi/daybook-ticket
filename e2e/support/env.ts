import { resolve } from 'node:path';

/** Everything the browser tests need to agree on: one local port, one disposable database, fictitious people. */
export const E2E_PORT = Number(process.env.DAYBOOK_E2E_PORT || 5180);
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
export const DATABASE_URL =
  process.env.DAYBOOK_E2E_DATABASE_URL ||
  'postgresql://daybook_e2e:daybook-e2e-disposable@127.0.0.1:55433/daybook_e2e?sslmode=disable';
export const OWNER_EMAIL = 'owner@example.test';
export const OWNER_NAME = 'Propietaria de Prueba';
export const STATE_DIR = resolve(process.cwd(), 'e2e', '.state');
export const RUN_FILE = resolve(STATE_DIR, 'run.json');
export const OWNER_SESSION = resolve(STATE_DIR, 'owner-session.json');

export type RunState = { invitationUrl: string; password: string };

/**
 * These tests wipe the database they point at. They only run against a local database whose name starts with
 * "daybook_e2e", so a copied production URL can never be emptied by accident.
 */
export function assertDisposableDatabase(connectionString: string) {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DAYBOOK_E2E_DATABASE_URL no es una URL de PostgreSQL válida.');
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!local || !/^daybook_e2e/.test(name))
    throw new Error(
      'Las pruebas E2E solo corren contra una base local desechable cuyo nombre empieza por daybook_e2e.',
    );
}
