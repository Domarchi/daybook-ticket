import Image from 'next/image';
/** Shared Daybook symbol copied unchanged from the Consorcio C17 brand source.
 * The Ticket product name is composed separately from the parent symbol. */
export default function Brand({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  return (
    <span
      className={`daybook-brand${dark ? ' daybook-brand-dark' : ''}${compact ? ' daybook-brand-compact' : ''}`}
      role="img"
      aria-label="Daybook Ticket"
    >
      <Image
        unoptimized
        className={dark ? undefined : 'daybook-mark-light'}
        src={`/brand/daybook-mark-on-${dark ? 'dark' : 'light'}.svg`}
        width="48"
        height="48"
        alt=""
        aria-hidden="true"
      />
      {/* On light surfaces the ink mark is used; when the page follows the dark theme the same spot turns dark,
          so the light-ink mark takes its place (CSS in evolution-theme.css picks one). */}
      {!dark && (
        <Image
          unoptimized
          className="daybook-mark-dark"
          src="/brand/daybook-mark-on-dark.svg"
          width="48"
          height="48"
          alt=""
          aria-hidden="true"
        />
      )}
      {!compact && (
        <span className="daybook-brand-type">
          <strong>DAYBOOK</strong>
          <span>TICKET</span>
        </span>
      )}
    </span>
  );
}
