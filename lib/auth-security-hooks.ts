/** Server-only decisions over successful Better Auth results. Never serialize these tokens as a DTO. */
export function successfulAuthProofs(input: {
  path: string;
  returned: unknown;
  newSession?: { session: { token: string }; user: { id: string } } | null;
}): { token: string; userId: string; factor: 'password' | 'mfa' }[] {
  const result = input.returned as {
    token?: unknown;
    twoFactorRedirect?: unknown;
    user?: { id?: unknown; twoFactorEnabled?: unknown };
  } | null;
  if (
    !result ||
    typeof result.token !== 'string' ||
    typeof result.user?.id !== 'string' ||
    result.twoFactorRedirect === true
  )
    return [];
  if (input.newSession && input.newSession.user.id !== result.user.id) return [];
  const token = input.newSession?.session.token ?? result.token,
    userId = input.newSession?.user.id ?? result.user.id;
  if (input.path === '/sign-in/email') return [{ token, userId, factor: 'password' }];
  if (!['/two-factor/verify-totp', '/two-factor/verify-backup-code'].includes(input.path)) return [];
  return [
    { token, userId, factor: 'mfa' },
    ...(input.newSession && result.user.twoFactorEnabled === true
      ? [{ token, userId, factor: 'password' as const }]
      : []),
  ];
}
