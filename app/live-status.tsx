import type { ConnectionStatus } from '@/hooks/use-workspace';
import './live-status.css';

const labels: Record<ConnectionStatus, string> = {
  connecting: 'Conectando…',
  live: 'Actualización automática',
  reconnecting: 'Reconectando…',
  offline: 'Sin conexión · reintentando',
};

export function LiveStatus({ connection }: { connection: ConnectionStatus }) {
  return <span className={`conversation-sync ${connection}`} role="status"><span aria-hidden="true" />{labels[connection]}</span>;
}
