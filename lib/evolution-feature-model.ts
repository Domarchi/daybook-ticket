import { z } from 'zod';
export const EVOLUTION_FEATURES = ['collaboration', 'organization', 'serviceContext', 'automation', 'knowledge', 'security', 'workspaces'] as const;
export type EvolutionFeature = typeof EVOLUTION_FEATURES[number];
export type EvolutionFeatures = Record<EvolutionFeature, boolean>;
export const featureChangeSchema = z.object({ expectedVersion: z.number().int().nonnegative(), features: z.object({
  collaboration: z.boolean().optional(), organization: z.boolean().optional(), serviceContext: z.boolean().optional(),
  automation: z.boolean().optional(), knowledge: z.boolean().optional(), security: z.boolean().optional(), workspaces: z.boolean().optional(),
}).strict() }).strict();
export function parseEvolutionFeatures(raw: string | null | undefined): EvolutionFeatures {
  let input: Record<string, unknown> = {};
  try { const value = JSON.parse(raw || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) input = value; } catch { /* An invalid configuration leaves new capabilities paused. */ }
  return Object.fromEntries(EVOLUTION_FEATURES.map(key => [key, input[key] === true])) as EvolutionFeatures;
}
