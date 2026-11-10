/** Fictitious-run cleanup waits for any timed-out app mutation to finish first. */
export async function withQaCleanup(pool, ownerId, work) {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query("SET LOCAL lock_timeout='15s'; SET LOCAL statement_timeout='20s'");
    if (ownerId)
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`daybook-ticket-work:${ownerId}`]);
    await work(tx);
    await tx.query('COMMIT');
  } catch (error) {
    await tx.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    tx.release();
  }
}
