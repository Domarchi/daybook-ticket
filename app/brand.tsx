/** Shared Daybook symbol copied unchanged from the Consorcio C17 brand source.
 * The Ticket product name is composed separately from the parent symbol. */
export default function Brand({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  return <span className={`daybook-brand${dark ? ' daybook-brand-dark' : ''}${compact ? ' daybook-brand-compact' : ''}`} role="img" aria-label="Daybook Ticket">
    <img src={`/brand/daybook-mark-on-${dark ? 'dark' : 'light'}.svg`} width="48" height="48" alt="" aria-hidden="true" />
    {!compact && <span className="daybook-brand-type"><strong>DAYBOOK</strong><span>TICKET</span></span>}
  </span>;
}
