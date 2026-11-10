/** A test is an explicit administrative designation. Never infer one from text,
 * email address or survey score. Client designation applies to its history;
 * the ticket flag also survives a later change of requester. */
export function productionTicketSql(alias: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(alias)) throw new Error('Invalid ticket alias');
  return `(NOT ${alias}."isTest" AND NOT EXISTS (SELECT 1 FROM members test_requester WHERE test_requester.id=${alias}."requesterMemberId" AND test_requester."ownerId"=${alias}."ownerId" AND test_requester."isTest"))`;
}

export function isTestTicket(
  ticket: { isTest?: boolean; requesterMemberId: string | null },
  members: { id: string; isTest?: boolean }[],
): boolean {
  return Boolean(ticket.isTest || members.some(member => member.id === ticket.requesterMemberId && member.isTest));
}
