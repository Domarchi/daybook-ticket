'use client';
import { type Ticket } from '../../lib/types';
import { Avatar, DeskLink, Priority, Status, since, sla } from './shared';

/**
 * The inbox on narrow screens: one card per ticket instead of a table that scrolls sideways.
 * Same data and actions as the table: the card opens the ticket, the checkbox feeds bulk actions.
 */
export function TicketCards({ tickets, selected, setSelected, now, onOpen }: {
    tickets: Ticket[];
    selected: number[];
    setSelected: (ids: number[]) => void;
    now: number;
    onOpen: (ticket: Ticket) => void;
}) {
    const allSelected = tickets.length > 0 && tickets.every(ticket => selected.includes(ticket.id));
    return <div className="ticket-cards-wrap">
        <label className="ticket-cards-select-all"><input type="checkbox" checked={allSelected} onChange={event => setSelected(event.target.checked ? tickets.map(ticket => ticket.id) : [])}/>Seleccionar tickets de esta vista</label>
        <ul className="ticket-cards" aria-label="Tickets">
            {tickets.map(ticket => {
                const checked = selected.includes(ticket.id);
                const late = ticket.status !== 'resolved' && sla(ticket, now) === 'Vencido';
                return <li key={ticket.id} className={`ticket-card${checked ? ' is-selected' : ''}`}>
                    <label className="ticket-card-check"><input type="checkbox" aria-label={`Seleccionar ticket ${ticket.id}`} checked={checked} onChange={event => setSelected(event.target.checked ? [...selected, ticket.id] : selected.filter(id => id !== ticket.id))}/></label>
                    <DeskLink className="ticket-card-main" to={{ ticketId: ticket.id }} onNavigate={() => onOpen(ticket)}>
                        <span className="ticket-card-top"><span className="ticket-number">#{String(ticket.id).padStart(4, '0')}</span><Status status={ticket.status}/><Priority priority={ticket.priority}/></span>
                        <span className="ticket-card-subject">{ticket.subject}</span>
                        <span className="ticket-card-meta">{ticket.requesterName} · {ticket.department}</span>
                        <span className="ticket-card-foot">
                            <span className="assignee">{ticket.assignee ? <><Avatar name={ticket.assignee} small/><span>{ticket.assignee.split(' ')[0]}</span></> : <span className="unassigned">Sin asignar</span>}</span>
                            <span className="ticket-card-time">{since(ticket.updatedAt, now) === 'Ahora' ? 'Actualizado ahora' : `Actualizado hace ${since(ticket.updatedAt, now)}`}{ticket.status !== 'resolved' && <> · <span className={late ? 'late-text' : ''}>{sla(ticket, now)}</span></>}</span>
                        </span>
                    </DeskLink>
                </li>;
            })}
        </ul>
    </div>;
}
