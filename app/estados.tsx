// Carga y vacío con el dibujo común de Parte Diario, Travel y Ticket (Fase 5c
// del estándar Daybook). El CSS es `@daybook/design/estados.css`, el mismo
// archivo en las tres apps; aquí solo va el marcado.
//
// Carga: mientras algo llega se dibuja su silueta y no un «Cargando…» suelto.
// El contenedor es `role="status"` y lleva el texto oculto a la vista, así el
// lector de pantalla lo sigue anunciando. El «…» visible queda para los botones.
//
// Vacío: ícono, título, una frase y, si la hay, una acción.
import type { CSSProperties, ReactNode } from 'react';

// Fijos y no al azar: el servidor y el cliente tienen que dibujar lo mismo.
const WIDTHS = ['72%', '48%', '86%', '60%', '40%', '78%'];

function LoadingRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="db-skeleton-region" role="status" aria-live="polite" aria-busy="true">
      <span className="db-visually-hidden">{label}</span>
      {children}
    </div>
  );
}

/** Tarjetas de una lista que todavía no llegó: un título y una o dos líneas. */
export function SkeletonList({ label, rows = 3, lines = 2 }: { label: string; rows?: number; lines?: number }) {
  return (
    <LoadingRegion label={label}>
      {Array.from({ length: rows }, (_, row) => (
        <div className="db-skeleton-card" key={row}>
          <span className="db-skeleton db-skeleton--title" style={{ width: WIDTHS[row % WIDTHS.length] }} />
          {Array.from({ length: lines }, (_, line) => (
            <span
              key={line}
              className="db-skeleton db-skeleton--text"
              style={{ width: WIDTHS[(row + line + 2) % WIDTHS.length] }}
            />
          ))}
        </div>
      ))}
    </LoadingRegion>
  );
}

/** Las filas de una tabla que todavía no llegó. */
export function SkeletonTable({ label, rows = 4, columns = 4 }: { label: string; rows?: number; columns?: number }) {
  return (
    <LoadingRegion label={label}>
      {Array.from({ length: rows }, (_, row) => (
        <div className="db-skeleton-row" key={row} style={{ '--db-skeleton-columns': columns } as CSSProperties}>
          {Array.from({ length: columns }, (_, column) => (
            <span
              key={column}
              className="db-skeleton db-skeleton--text"
              style={{ width: WIDTHS[(row + column) % WIDTHS.length] }}
            />
          ))}
        </div>
      ))}
    </LoadingRegion>
  );
}

/** El vacío común: ícono, título, una frase y, si la hay, una acción. */
export function EmptyState({
  icon,
  title,
  text,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  text: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className ? `db-empty ${className}` : 'db-empty'}>
      <span className="db-empty__icon" aria-hidden="true">
        {icon}
      </span>
      <h3 className="db-empty__title">{title}</h3>
      <p className="db-empty__text">{text}</p>
      {action && <div className="db-empty__action">{action}</div>}
    </div>
  );
}
