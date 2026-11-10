import { ApiError, db } from './server';
import { recordSecurityEvent } from './security';
import { requireAdmin, type AccessContext } from './access';
import { acquireTicketWorkLock } from './work-lock';
import { lockAccess } from './ticket-mutations';
import { featureChangeSchema, parseEvolutionFeatures, type EvolutionFeature } from './evolution-feature-model';
import type { z } from 'zod';

export async function getEvolutionFeatures(ownerId: string) {
  try {
    const row = await db()
      .prepare('SELECT "featuresJson",version FROM "evolutionFeatures" WHERE "ownerId"=$1')
      .bind(ownerId)
      .first<{ featuresJson: string; version: number }>();
    return { features: parseEvolutionFeatures(row?.featuresJson), version: row?.version ?? 0, available: true };
  } catch (error) {
    if ((error as { code?: string }).code !== '42P01') throw error;
    return { features: parseEvolutionFeatures(null), version: 0, available: false };
  }
}
export async function requireEvolutionFeature(access: AccessContext, feature: EvolutionFeature) {
  if (!(await getEvolutionFeatures(access.ownerId)).features[feature])
    throw new ApiError(503, 'Esta función está en pausa para este espacio. Sus datos se conservan.');
}
export async function changeEvolutionFeatures(access: AccessContext, input: z.infer<typeof featureChangeSchema>) {
  return db().transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh = requireAdmin(await lockAccess(tx, access));
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`features:${access.ownerId}`]);
    const row = (await tx.query('SELECT * FROM "evolutionFeatures" WHERE "ownerId"=$1 FOR UPDATE', [access.ownerId]))
      .rows[0];
    if ((row?.version ?? 0) !== input.expectedVersion)
      throw new ApiError(409, 'La configuración cambió. Actualiza antes de guardar.');
    const features = { ...parseEvolutionFeatures(row?.featuresJson), ...input.features };
    // Multi-business pilots require the independent security gate, not just this UI switch.
    if (features.workspaces && fresh.role !== 'owner')
      throw new ApiError(403, 'Solo el propietario puede preparar los pilotos.');
    await tx.query(
      'INSERT INTO "evolutionFeatures" ("ownerId","featuresJson",version,"updatedAt") VALUES ($1,$2,$3,$4) ON CONFLICT ("ownerId") DO UPDATE SET "featuresJson"=EXCLUDED."featuresJson",version=EXCLUDED.version,"updatedAt"=EXCLUDED."updatedAt"',
      [access.ownerId, JSON.stringify(features), (row?.version ?? 0) + 1, new Date().toISOString()],
    );
    await recordSecurityEvent(tx, fresh, 'configuration_changed');
    return { features, version: (row?.version ?? 0) + 1, available: true };
  });
}
