/** Reconcile at render and action time: hidden or removed tickets must never be mutated. */
export function visibleTicketSelection(selected: readonly number[], visibleTickets: readonly { id: number }[]): number[] {
  const visible = new Set(visibleTickets.map(ticket => ticket.id));
  return [...new Set(selected)].filter(id => visible.has(id));
}
