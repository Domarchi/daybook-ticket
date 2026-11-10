export type ComboboxOption = { value: string; label: string; hint?: string; disabled?: boolean };

/** Lower case, without accents, single spaces: "María  López" and "maria lopez" match each other. */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Options that contain every word of the query in their label or hint (email, role...).
 * Matches at the start of the label come first, then the rest in their original order.
 * An empty query keeps everything.
 */
export function filterOptions<T extends ComboboxOption>(options: readonly T[], query: string): T[] {
  const terms = normalizeSearch(query).split(' ').filter(Boolean);
  if (terms.length === 0) return [...options];
  const scored: { option: T; rank: number; index: number }[] = [];
  options.forEach((option, index) => {
    const label = normalizeSearch(option.label),
      text = `${label} ${normalizeSearch(option.hint ?? '')}`;
    if (!terms.every(term => text.includes(term))) return;
    scored.push({ option, rank: label.startsWith(terms[0]) ? 0 : label.includes(terms[0]) ? 1 : 2, index });
  });
  return scored.sort((a, b) => a.rank - b.rank || a.index - b.index).map(item => item.option);
}

/** The next enabled option in a direction, wrapping around; -1 when nothing can be chosen. */
export function stepActive(options: readonly ComboboxOption[], from: number, direction: 1 | -1): number {
  const count = options.length;
  if (count === 0 || options.every(option => option.disabled)) return -1;
  let index = from;
  for (let step = 0; step < count; step++) {
    index = index < 0 ? (direction === 1 ? 0 : count - 1) : (index + direction + count) % count;
    if (!options[index].disabled) return index;
  }
  return -1;
}

export function firstEnabled(options: readonly ComboboxOption[]): number {
  return options.findIndex(option => !option.disabled);
}

export function resultsAnnouncement(count: number): string {
  return count === 0 ? 'Sin resultados' : count === 1 ? '1 resultado' : `${count} resultados`;
}
