'use client';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { ChevronDown, Ticket } from 'lucide-react';

const subscribe = (listener: () => void) => {
  const media = matchMedia('(max-width: 900px)');
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};
const mobileSnapshot = () => matchMedia('(max-width: 900px)').matches;
export function TicketDetails({ children }: { children: ReactNode }) {
  const mobile = useSyncExternalStore(subscribe, mobileSnapshot, () => false);
  const [override, setOverride] = useState<boolean | null>(null);
  const expanded = override ?? !mobile;
  return (
    <details className="detail-aside responsive-ticket-details" open={expanded}>
      <summary
        className="section-head"
        onClick={event => {
          event.preventDefault();
          setOverride(!expanded);
        }}
      >
        <h2>
          <Ticket size={17} />
          Detalles del ticket
        </h2>
        <ChevronDown size={17} />
      </summary>
      {children}
    </details>
  );
}
