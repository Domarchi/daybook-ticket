import Brand from '../brand';
import '../login/login.css';

export default function SetupForm() {
  return <main className="auth-main" style={{ minHeight: '100dvh' }}>
    <div className="auth-form-wrap">
      <div className="setup-brand"><Brand /></div>
      <span className="auth-eyebrow">SERVICIOS DAYBOOK</span>
      <h1>Activa tu cuenta.</h1>
      <p>Abre el enlace de invitación que recibiste para crear tu contraseña de Daybook Ticket.</p>
      <p>Si eres el propietario, utiliza el enlace privado de activación entregado al configurar tu espacio. Este enlace es personal y vence a las 72 horas.</p>
      <a className="auth-switch" href="/login">Ya activé mi cuenta · Iniciar sesión</a>
    </div>
  </main>;
}
