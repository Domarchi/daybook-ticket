'use client';
import { FAULT_GROUPS, REQUIREMENTS, type CategoryCorrection } from '../../lib/ticket-category-model';
import type { Ticket } from '../../lib/types';

type Correction = { [key in keyof CategoryCorrection]: string | null };

/**
 * The classification of a ticket: what failed and what is being asked. The classifier suggests it when the ticket
 * is created; any change made here is a person's choice, and the classifier never overwrites it.
 */
export function TicketCategoryPanel({
  ticket,
  disabled,
  onSave,
}: {
  ticket: Ticket;
  disabled: boolean;
  onSave: (category: Correction) => void;
}) {
  const source = ticket.categorySource ?? null;
  const fault = ticket.faultGroup ? `${ticket.faultGroup}:${ticket.faultElement ?? ''}` : '';
  const requirement = ticket.requirement ?? '';
  const save = (faultValue: string, requirementValue: string) => {
    const [group, element] = faultValue ? faultValue.split(':') : ['', ''];
    onSave({ faultGroup: group || null, faultElement: element || null, requirement: requirementValue || null });
  };
  const note =
    source === 'manual'
      ? 'Revisada por el equipo.'
      : source === 'bot'
        ? ticket.categoryConfidence === 'low'
          ? 'Sugerida automáticamente con poca certeza: revísala.'
          : 'Sugerida automáticamente a partir de la descripción.'
        : 'Ticket anterior a la clasificación automática.';
  return (
    <fieldset className="ticket-category" disabled={disabled}>
      <legend>Clasificación</legend>
      <label>
        Elemento fallado
        <select value={fault} onChange={event => save(event.target.value, requirement)}>
          <option value="">{source ? 'Sin falla' : 'Sin clasificar'}</option>
          {FAULT_GROUPS.map(group =>
            group.elements.length ? (
              <optgroup key={group.id} label={group.label}>
                <option value={`${group.id}:`}>{group.label} (sin precisar)</option>
                {group.elements.map(element => (
                  <option key={element.id} value={`${group.id}:${element.id}`}>
                    {element.label}
                  </option>
                ))}
              </optgroup>
            ) : (
              <option key={group.id} value={`${group.id}:`}>
                {group.label}
              </option>
            ),
          )}
        </select>
      </label>
      <label>
        Requerimiento
        <select value={requirement} onChange={event => save(fault, event.target.value)}>
          <option value="">Sin requerimiento</option>
          {REQUIREMENTS.map(item => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <small className="ticket-category-note">{note}</small>
      {source === 'bot' && (
        <button type="button" className="text-button" onClick={() => save(fault, requirement)}>
          Confirmar clasificación
        </button>
      )}
    </fieldset>
  );
}
