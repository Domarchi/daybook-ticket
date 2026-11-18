'use client';
import { useState } from 'react';
import { Download, KeyRound, Link2, RefreshCw } from 'lucide-react';
import { daybookFetch } from '@/lib/browser-request';
import { invitationState } from '@/lib/invitation-links-model';
import { importLinksCsv, type ImportedInvitation } from '@/lib/member-import-model';
import type { Member } from '@/lib/types';
import { downloadCsv } from './member-import';
import './member-import.css';

type Run = (action: () => Promise<unknown>, message: string) => Promise<boolean>;
type Renewed = { invitations: ImportedInvitation[]; expiresAt: string };

/**
 * Pending invitations at a glance and «Renovar enlaces» for many at once (Fase 7, L3). Renewing makes the old links
 * stop working, so renewing links that still work asks first. The new links are offered once, as a CSV; no mail is sent.
 * `members` are the invitations this admin may manage.
 */
export function PendingInvitationsPanel({
  members,
  now,
  busy,
  run,
}: {
  members: Member[];
  now: Date;
  busy: boolean;
  run: Run;
}) {
  const [confirmingAll, setConfirmingAll] = useState(false),
    [renewed, setRenewed] = useState<Renewed | null>(null),
    [error, setError] = useState<{ message: string; redirectTo?: string } | null>(null),
    [working, setWorking] = useState(false);
  const pending = members.filter(member => invitationState(member, now) !== null),
    expired = pending.filter(member => invitationState(member, now) === 'expired');
  if (!pending.length && !renewed) return null;

  const renew = async (targets: Member[]) => {
    setWorking(true);
    setError(null);
    setConfirmingAll(false);
    try {
      const response = await daybookFetch('/api/members/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberIds: targets.map(member => member.id) }),
      });
      const result: Record<string, unknown> = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError({
          message: typeof result.error === 'string' ? result.error : 'No se pudieron renovar los enlaces.',
          redirectTo: typeof result.redirectTo === 'string' ? result.redirectTo : undefined,
        });
        return;
      }
      const value = result as unknown as Renewed;
      setRenewed(value);
      await run(async () => undefined, `${value.invitations.length} enlaces renovados`);
    } catch {
      setError({ message: 'No se pudieron renovar los enlaces. Revisa tu conexión e inténtalo de nuevo.' });
    } finally {
      setWorking(false);
    }
  };
  const disabled = busy || working;

  return (
    <section className="panel member-import pending-invitations" aria-labelledby="pending-invitations-title">
      <div className="section-head">
        <h2 id="pending-invitations-title">Enlaces de invitación</h2>
        <Link2 size={18} aria-hidden="true" />
      </div>
      {renewed ? (
        <div className="member-import-result" role="status">
          <p className="member-import-done">
            Se renovaron {renewed.invitations.length} enlaces. Vencen el{' '}
            {new Date(renewed.expiresAt).toLocaleString('es-CL', { dateStyle: 'long', timeStyle: 'short' })}; los
            anteriores ya no funcionan.
          </p>
          <p className="member-import-warning">
            <KeyRound size={16} aria-hidden="true" />
            Cada enlace permite crear la cuenta de esa persona. Entrégalo solo a ella y no reenvíes el archivo completo.
          </p>
          <div className="member-import-actions">
            <button
              type="button"
              className="primary"
              onClick={() =>
                downloadCsv('daybook-enlaces-renovados.csv', importLinksCsv(renewed.invitations, renewed.expiresAt))
              }
            >
              <Download size={15} aria-hidden="true" />
              Descargar enlaces (CSV)
            </button>
            <button type="button" className="secondary" onClick={() => setRenewed(null)}>
              Listo
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="member-import-summary">
            {pending.length === 1 ? '1 invitación pendiente' : `${pending.length} invitaciones pendientes`}
            {' · '}
            {expired.length === 1 ? '1 enlace vencido' : `${expired.length} enlaces vencidos`}
          </p>
          <p className="member-import-note">
            Renovar crea enlaces nuevos de 72 horas y anula los anteriores. No se envía ningún correo: descargas los
            enlaces para repartirlos.
          </p>
          <div className="member-import-actions">
            {expired.length > 0 && (
              <button type="button" className="primary" disabled={disabled} onClick={() => void renew(expired)}>
                <RefreshCw size={15} aria-hidden="true" />
                Renovar vencidos ({expired.length})
              </button>
            )}
            {pending.length > expired.length && !confirmingAll && (
              <button type="button" className="secondary" disabled={disabled} onClick={() => setConfirmingAll(true)}>
                Renovar todos ({pending.length})
              </button>
            )}
          </div>
          {confirmingAll && (
            <div className="member-import-actions" role="group" aria-label="Confirmar renovación de todos los enlaces">
              <p className="member-import-note">
                {pending.length - expired.length === 1
                  ? '1 enlace vigente dejará de funcionar.'
                  : `${pending.length - expired.length} enlaces vigentes dejarán de funcionar.`}{' '}
                ¿Renovar los {pending.length}?
              </p>
              <button type="button" className="primary" disabled={disabled} onClick={() => void renew(pending)}>
                Sí, renovar {pending.length}
              </button>
              <button type="button" className="secondary" onClick={() => setConfirmingAll(false)}>
                Cancelar
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="member-import-error">
              {error.message}
              {error.redirectTo && (
                <>
                  {' '}
                  <a href={error.redirectTo}>Verificar mi identidad</a>
                </>
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
