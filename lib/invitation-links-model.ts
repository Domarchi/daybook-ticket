/** Pending invitation links (Fase 7, L3): which ones still work and which ones to renew together. Pure. */
import { z } from 'zod';

export const RENEW_MAX = 500;
export const renewInvitationsSchema = z
  .object({
    memberIds: z
      .array(z.string().uuid('Selecciona cuentas válidas.'))
      .min(1, 'Selecciona al menos una invitación.')
      .max(RENEW_MAX, `Renueva hasta ${RENEW_MAX} invitaciones por vez.`)
      .refine(ids => new Set(ids).size === ids.length, 'Hay cuentas repetidas.'),
  })
  .strict();

export type InvitationState = 'pending' | 'expired';
/** Null for anyone who is not waiting on an invitation, or whose invitation row is gone (renewing creates it). */
export function invitationState(
  member: { status: string; hasAccount?: boolean; invitationExpiresAt?: string | null },
  now: Date,
): InvitationState | null {
  if (member.status !== 'invited' || member.hasAccount) return null;
  if (!member.invitationExpiresAt) return 'expired';
  return new Date(member.invitationExpiresAt).getTime() > now.getTime() ? 'pending' : 'expired';
}

export function invitationStateLabel(state: InvitationState, expiresAt: string | null | undefined): string {
  if (state === 'expired') return 'Enlace vencido';
  const when = expiresAt
    ? new Date(expiresAt).toLocaleString('es-CL', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
  return when ? `Enlace vigente hasta el ${when}` : 'Enlace vigente';
}
