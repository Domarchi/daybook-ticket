import type { AccessContext } from './access';
import { getAlertsPage } from './alerts';
import { getTicketCounts, getTicketDepartments, getTicketPage } from './ticket-search';
import { parseTicketSearch } from './ticket-search-query';

// Keep the initial workspace and automatic updates under the same visibility rules.
export async function getTicketFeed(access: AccessContext) {
  const [ticketPage, ticketCounts, ticketDepartments, alertsPage] = await Promise.all([
    getTicketPage(access, parseTicketSearch(new URLSearchParams())),
    getTicketCounts(access),
    getTicketDepartments(access),
    getAlertsPage(access),
  ]);
  return {
    tickets: ticketPage.items,
    messages: [],
    ticketPage,
    ticketCounts,
    ticketDepartments,
    alerts: alertsPage.items,
    alertsPage,
  };
}
