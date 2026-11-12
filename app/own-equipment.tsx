'use client';
import { daybookFetch } from '@/lib/browser-request';
import { useEffect, useState } from 'react';
import { Laptop } from 'lucide-react';
import { equipmentLabel, type OwnEquipment } from '../lib/client-equipment-model';
import './equipment-panel.css';

async function readEquipment(memberId: string, path: string, signal: AbortSignal): Promise<OwnEquipment[]> {
  const response = await daybookFetch(path, {
    cache: 'no-store',
    headers: { 'X-Daybook-Member-Id': memberId },
    signal,
  });
  if (!response.ok) throw new Error('Equipment unavailable');
  const body = (await response.json()) as { equipment?: OwnEquipment[] };
  return Array.isArray(body.equipment) ? body.equipment : [];
}

/** The signed-in person's equipment. Empty while loading or when the request fails: it is a convenience, never a gate. */
export function useOwnEquipment(memberId: string): OwnEquipment[] {
  const [state, setState] = useState<{ memberId: string; items: OwnEquipment[] }>({ memberId: '', items: [] });
  useEffect(() => {
    const controller = new AbortController();
    readEquipment(memberId, '/api/equipment/mine', controller.signal)
      .then(items => setState({ memberId, items }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [memberId]);
  return state.memberId === memberId ? state.items : [];
}

/** "Mis equipos" in the client portal. */
export function OwnEquipmentStrip({ items }: { items: OwnEquipment[] }) {
  if (!items.length) return null;
  return (
    <section className="own-equipment" aria-labelledby="own-equipment-title">
      <h2 id="own-equipment-title">
        <Laptop size={17} aria-hidden="true" />
        Mis equipos
      </h2>
      <ul>
        {items.map(item => (
          <li key={item.id}>
            <strong>{item.assetTag ?? item.name}</strong>
            <span>
              {item.category}
              {item.serial ? ` · Serie ${item.serial}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The equipment a ticket is about, shown to whoever handles it. Renders nothing when the ticket names none. */
export function TicketEquipment({ memberId, ticketId }: { memberId: string; ticketId: number }) {
  const [state, setState] = useState<{ key: string; items: OwnEquipment[] }>({ key: '', items: [] });
  const key = `${memberId}:${ticketId}`;
  useEffect(() => {
    const controller = new AbortController();
    readEquipment(memberId, `/api/tickets/${ticketId}/equipment`, controller.signal)
      .then(items => setState({ key, items }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [memberId, ticketId, key]);
  const items = state.key === key ? state.items : [];
  if (!items.length) return null;
  return (
    <div className="ticket-equipment">
      <span className="eyebrow">EQUIPO</span>
      <ul>
        {items.map(item => (
          <li key={item.id}>
            <Laptop size={15} aria-hidden="true" />
            <span>
              <strong>{equipmentLabel(item)}</strong>
              {item.serial && <small>Serie {item.serial}</small>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
