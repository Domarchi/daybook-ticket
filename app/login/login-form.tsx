'use client';
import { daybookFetch } from '@/lib/browser-request';

import { useState } from 'react';
import { ArrowRight, ShieldCheck, LoaderCircle } from 'lucide-react';
import Brand from '../brand';
import { safeTicketReturnPath, ticketLoginPath } from '../../lib/return-path';
import './login.css';
type Invite = { token: string; email: string; name: string; existingAccount?: boolean };
export default function LoginForm({
  invite,
  invalidInvite,
  resetToken,
  returnTo = '/',
}: {
  invite?: Invite;
  invalidInvite: boolean;
  resetToken?: string;
  returnTo?: string;
}) {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [secondFactor, setSecondFactor] = useState(false),
    [useRecovery, setUseRecovery] = useState(false);
  const signingUp = Boolean(invite && !invite.existingAccount);
  const heading = secondFactor
    ? 'Verifica tu identidad.'
    : invite
      ? 'Tu espacio está listo.'
      : resetToken
        ? 'Una nueva contraseña.'
        : mode === 'forgot'
          ? 'Recupera tu acceso.'
          : 'Inicia sesión';
  const destination = safeTicketReturnPath(returnTo);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError('');
    setNotice('');
    setBusy(true);
    const f = new FormData(e.currentTarget),
      email = String(f.get('email') || ''),
      password = String(f.get('password') || '');
    if ((signingUp || resetToken) && password !== f.get('confirm')) {
      setError('Las contraseñas no coinciden.');
      setBusy(false);
      return;
    }
    let path = 'sign-in/email',
      body: Record<string, unknown> = { email, password };
    if (secondFactor) {
      path = useRecovery ? 'two-factor/verify-backup-code' : 'two-factor/verify-totp';
      body = { code: String(f.get('code') || '') };
    } else if (signingUp && invite) {
      path = 'sign-up/email';
      body = { email: invite.email, name: invite.name, password };
    } else if (resetToken) {
      path = 'reset-password';
      body = { token: resetToken, newPassword: password };
    } else if (mode === 'forgot') {
      path = 'request-password-reset';
      body = {
        email,
        redirectTo: `${location.origin}/login?reset=1${destination === '/' ? '' : `&return_to=${encodeURIComponent(destination)}`}`,
      };
    }
    try {
      const response = await daybookFetch(`/api/auth/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(invite ? { 'x-daybook-invite': invite.token } : {}) },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string; twoFactorRedirect?: boolean };
      if (!response.ok) {
        if (response.status === 429)
          throw new Error('Has realizado varios intentos. Espera unos minutos y vuelve a probar.');
        if (response.status === 503)
          throw new Error('La recuperación por correo aún no está configurada. Contacta con el administrador.');
        if (result.message?.includes('invitación')) throw new Error(result.message);
        throw new Error(
          secondFactor
            ? 'El código no es válido o la verificación venció. Revisa el código o vuelve a iniciar sesión.'
            : resetToken
              ? 'El enlace venció o ya fue utilizado. Solicita uno nuevo.'
              : invite
                ? 'No pudimos activar la cuenta. Si ya la activaste, inicia sesión; de lo contrario pide una nueva invitación.'
                : mode === 'forgot'
                  ? 'No se pudo solicitar la recuperación. Intenta nuevamente.'
                  : 'Revisa tu correo y contraseña e intenta nuevamente.',
        );
      }
      if (result.twoFactorRedirect) {
        setSecondFactor(true);
        form.reset();
      } else if (mode === 'forgot' && !invite && !resetToken)
        setNotice('Si existe una cuenta activa con ese correo, recibirás un enlace para recuperar el acceso.');
      else if (resetToken) {
        location.replace(ticketLoginPath(destination));
      } else if (invite) {
        const accepted = await daybookFetch('/api/workspaces/invitations/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: invite.token }),
        });
        if (!accepted.ok)
          throw new Error(
            'La sesión está iniciada, pero no se pudo aceptar esta invitación. Solicita un enlace nuevo.',
          );
        const result = await accepted.json();
        location.replace(result.workspaceId === 'daybook' ? '/' : `/w/${result.workspaceId}`);
      } else location.replace(destination);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos completar la operación.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <header className="auth-topbar">
        <a href="/login" aria-label="Daybook Ticket · Inicio">
          <Brand />
        </a>
        <span className="auth-private">
          <ShieldCheck size={16} />
          Acceso privado
        </span>
      </header>
      <main className="auth-main">
        <div className="auth-form-wrap">
          <div className="auth-icon">
            <Brand compact />
          </div>
          <span className="auth-eyebrow">DAYBOOK TICKET · CENTRO DE SOPORTE</span>
          <h1>{heading}</h1>
          <p>
            {secondFactor
              ? useRecovery
                ? 'Usa uno de los códigos de recuperación que guardaste.'
                : 'Introduce el código de tu aplicación autenticadora.'
              : invite
                ? `Hola, ${invite.name}. ${signingUp ? 'Crea tu contraseña' : 'Inicia sesión con tu contraseña habitual'} para aceptar esta invitación.`
                : resetToken
                  ? 'Elige una contraseña de al menos 12 caracteres.'
                  : mode === 'forgot'
                    ? 'Te enviaremos un enlace para volver a entrar.'
                    : 'Accede con tu correo y contraseña para continuar.'}
          </p>
          {invalidInvite && (
            <div className="auth-error" role="alert">
              La invitación venció o ya fue utilizada. Si ya tienes una cuenta, inicia sesión. Si no, pide un enlace
              nuevo a tu equipo.
            </div>
          )}
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              {!secondFactor && !resetToken && (
                <label>
                  Correo electrónico
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    defaultValue={invite?.email}
                    readOnly={Boolean(invite)}
                    required
                    maxLength={254}
                    placeholder="tu@empresa.com"
                  />
                </label>
              )}
              {!secondFactor && (invite || resetToken || mode === 'login') && (
                <label>
                  Contraseña
                  <input
                    name="password"
                    type="password"
                    autoComplete={invite || resetToken ? 'new-password' : 'current-password'}
                    required
                    minLength={invite || resetToken ? 12 : 1}
                    maxLength={128}
                    placeholder={invite || resetToken ? 'Mínimo 12 caracteres' : 'Tu contraseña'}
                  />
                </label>
              )}
              {!secondFactor && (signingUp || resetToken) && (
                <label>
                  Repite tu contraseña
                  <input
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                  />
                </label>
              )}
              {secondFactor && (
                <label>
                  {useRecovery ? 'Código de recuperación' : 'Código del autenticador'}
                  <input
                    key={useRecovery ? 'recovery' : 'totp'}
                    name="code"
                    type="text"
                    inputMode={useRecovery ? 'text' : 'numeric'}
                    autoComplete="one-time-code"
                    required
                    minLength={useRecovery ? 1 : 6}
                    maxLength={useRecovery ? 64 : 6}
                    pattern={useRecovery ? undefined : '[0-9]{6}'}
                    autoFocus
                  />
                </label>
              )}
              {error && (
                <div role="alert" className="auth-error">
                  {error}
                </div>
              )}
              {notice && (
                <div role="status" className="auth-notice">
                  {notice}
                </div>
              )}
              <button className="auth-submit" disabled={busy}>
                {busy ? <LoaderCircle size={18} className="spin" /> : <ArrowRight size={18} />}{' '}
                {busy
                  ? 'Un momento…'
                  : secondFactor
                    ? 'Verificar código'
                    : invite
                      ? signingUp
                        ? 'Activar mi cuenta'
                        : 'Entrar y aceptar'
                      : resetToken
                        ? 'Guardar contraseña'
                        : mode === 'forgot'
                          ? 'Enviar enlace'
                          : 'Entrar a mi espacio'}
              </button>
            </fieldset>
          </form>
          {secondFactor && (
            <>
              <button
                type="button"
                className="auth-switch"
                disabled={busy}
                onClick={() => {
                  setUseRecovery(!useRecovery);
                  setError('');
                }}
              >
                {useRecovery ? 'Usar mi aplicación autenticadora' : 'Usar un código de recuperación'}
              </button>
              <button
                type="button"
                className="auth-switch"
                disabled={busy}
                onClick={() => {
                  setSecondFactor(false);
                  setUseRecovery(false);
                  setError('');
                }}
              >
                Volver al inicio de sesión
              </button>
            </>
          )}
          {!secondFactor && !invite && !resetToken && (
            <button
              className="auth-switch"
              disabled={busy}
              onClick={() => {
                setMode(mode === 'login' ? 'forgot' : 'login');
                setError('');
                setNotice('');
              }}
            >
              {mode === 'login' ? 'Olvidé mi contraseña' : 'Volver al inicio de sesión'}
            </button>
          )}
          {(signingUp || resetToken) && (
            <a className="auth-switch" href={ticketLoginPath(destination)}>
              Ya tengo una cuenta · Iniciar sesión
            </a>
          )}
          <div className="auth-invite-note">
            <ShieldCheck size={17} />
            <p>El acceso es por invitación. Tu equipo de Daybook puede habilitar una cuenta para ti.</p>
          </div>
          <details className="auth-owner">
            <summary>¿Eres el propietario del espacio?</summary>
            <a className="auth-owner-link" href="/setup">
              Cómo activar mi cuenta propietaria
            </a>
          </details>
        </div>
      </main>
      <footer className="auth-footer">
        Daybook Ticket<span aria-hidden="true">·</span>Servicios Daybook
      </footer>
    </div>
  );
}
