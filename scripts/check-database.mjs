/** PostgreSQL adapter integration checks. Requires an explicitly isolated test branch.
 * Run: node --env-file=.env.test.local scripts/check-database.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Database } from '../db/database.ts';
import { databaseCheckCi } from './database-check-target.mjs';
const databaseCi = databaseCheckCi();

if (!databaseCi) {
  assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1', 'Autoriza explícitamente una base de pruebas aislada.');
  assert.ok(
    process.env.DATABASE_URL && process.env.DAYBOOK_QA_DATABASE_HOST,
    'Falta el hostname esperado de la rama de pruebas.',
  );
  assert.equal(
    new URL(process.env.DATABASE_URL).hostname,
    process.env.DAYBOOK_QA_DATABASE_HOST,
    'La conexión debe apuntar exactamente a la rama de pruebas.',
  );
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const database = new Database(pool);
const fixtureId = `qa-transaction-${randomUUID()}`;

try {
  const shape = await pool.query(`SELECT table_name, column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND ((table_name = 'authRateLimit' AND column_name = 'lastRequest')
      OR (table_name = 'authUser' AND column_name IN ('createdAt', 'emailVerified')))`);
  const types = Object.fromEntries(shape.rows.map(row => [`${row.table_name}.${row.column_name}`, row.data_type]));
  assert.equal(types['authRateLimit.lastRequest'], 'bigint');
  assert.equal(types['authUser.createdAt'], 'timestamp with time zone');
  assert.equal(types['authUser.emailVerified'], 'boolean');

  await assert.rejects(
    database.batch([
      database.prepare('INSERT INTO settings("ownerId", data) VALUES ($1, $2)').bind(fixtureId, 'must roll back'),
      database.prepare('SELECT 1 / 0'),
    ]),
    /division by zero/,
    'El fallo de una sentencia debe abortar el lote completo',
  );
  assert.equal(
    await database.prepare('SELECT data FROM settings WHERE "ownerId" = $1').bind(fixtureId).first(),
    null,
    'No queda el primer write tras rollback',
  );

  const text = "Parámetro literal con ' comilla, $1 y ?";
  const committed = await database.batch([
    database
      .prepare('INSERT INTO settings("ownerId", data) VALUES ($1, $2) RETURNING "ownerId", data')
      .bind(fixtureId, text),
    database.prepare('SELECT data FROM settings WHERE "ownerId" = $1').bind(fixtureId),
    database.prepare('UPDATE settings SET data = $1 WHERE "ownerId" = $2 RETURNING data').bind('updated', fixtureId),
  ]);
  assert.equal(committed[0].meta.changes, 1);
  assert.equal(committed[0].results[0].ownerId, fixtureId);
  assert.equal(committed[1].results[0].data, text, 'Las sentencias ven los writes anteriores en el mismo lote');
  assert.equal(committed[2].results[0].data, 'updated');
  assert.equal(
    (await database.prepare('SELECT data FROM settings WHERE "ownerId" = $1').bind(fixtureId).first()).data,
    'updated',
  );
  assert.equal(
    (
      await database
        .prepare('UPDATE settings SET data = $1 WHERE "ownerId" = $2')
        .bind('never', 'nonexistent-qa-owner')
        .run()
    ).meta.changes,
    0,
  );
  assert.deepEqual(await database.batch([]), []);
  const otherDatabase = new Database(pool);
  await assert.rejects(
    database.batch([otherDatabase.prepare('SELECT 1')]),
    /another database/,
    'No mezclar sentencias de otra conexión lógica',
  );
  console.log('PostgreSQL verificado: tipos de auth, parámetros, resultados, orden y rollback atómico del adaptador.');
} finally {
  try {
    await pool.query('DELETE FROM settings WHERE "ownerId" = $1', [fixtureId]);
  } finally {
    await pool.end();
  }
}
