'use client';
import { CheckCircle2, ChevronRight } from 'lucide-react';
import { type Ticket, type Workspace } from '../../lib/types';
import { since, Avatar, Status, Empty } from './shared';

export function Overview({ data, now, onOpen }: { data: Workspace; now: number; onOpen: (t: Ticket) => void }) {
  const total = data.ticketCounts?.all ?? data.tickets.length;
  const resolved = data.ticketCounts?.resolved ?? 0;
  return (
    <div className="overview-grid">
      <section className="panel">
        <div className="section-head">
          <h2>Distribución por departamento</h2>
          <span>Todos los tickets</span>
        </div>
        <div className="bar-chart">
          {[
            ...new Set([...data.settings.departments, ...(data.ticketDepartments ?? []).map(item => item.department)]),
          ].map((d, i) => {
            const n = data.ticketDepartments?.find(item => item.department === d)?.total ?? 0;
            return (
              <div className="bar-row" key={d}>
                <div>
                  <span>{d}</span>
                  <strong>{n}</strong>
                </div>
                <div className="bar-track">
                  <span
                    style={{
                      width: `${total ? (n / total) * 100 : 0}%`,
                      background: ['#6375d6', '#94afa6', '#c8d58b'][i % 3],
                    }}
                  />
                </div>
              </div>
            );
          })}
          <small>Distribución calculada a partir de tus conversaciones.</small>
        </div>
      </section>
      <section className="panel">
        <div className="section-head">
          <h2>Balance de atención</h2>
          <CheckCircle2 size={18} />
        </div>
        <div className="resolution">
          <div
            className="donut"
            style={{ background: `conic-gradient(#8daba1 ${(total ? resolved / total : 0) * 360}deg,#eef0ec 0deg)` }}
          >
            <div>
              <strong>{total ? Math.round((resolved / total) * 100) : 0}%</strong>
              <span>solucionados</span>
            </div>
          </div>
          <p>
            {resolved} de {total} conversaciones
            <br />
            se han completado.
          </p>
        </div>
      </section>
      <section className="panel recent">
        <div className="section-head">
          <h2>Últimas conversaciones</h2>
          <span>Actividad reciente</span>
        </div>
        {data.tickets.length === 0 ? (
          <Empty title="Todo listo para empezar">Aquí verás las conversaciones más recientes.</Empty>
        ) : (
          data.tickets.slice(0, 5).map(t => (
            <button className="recent-row" key={t.id} onClick={() => onOpen(t)}>
              <Avatar name={t.requesterName} small />
              <div>
                <strong>{t.subject}</strong>
                <small>
                  {t.requesterName} · {since(t.updatedAt, now)}
                </small>
              </div>
              <Status ticket={t} />
              <ChevronRight size={17} />
            </button>
          ))
        )}
      </section>
    </div>
  );
}
