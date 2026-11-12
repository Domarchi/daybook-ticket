/**
 * The inventory ID of a piece of equipment ("ID del equipo"): what is written on its label.
 * Stored normalized so that " nb-0042 " and "NB-0042" are the same equipment and the unique index can match them.
 */
export const ASSET_TAG_MAX_LENGTH = 64;
const ALLOWED = /^[A-Z0-9][A-Z0-9 ._/-]*$/;

/** Trims, collapses inner spaces and upper-cases. Does not validate: see `assetTagProblem`. */
export function normalizeAssetTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** The message to show when an inventory ID cannot be used, or null when it is valid (after normalizing). */
export function assetTagProblem(raw: unknown): string | null {
  if (typeof raw !== 'string') return 'Escribe el ID del equipo.';
  const tag = normalizeAssetTag(raw);
  if (!tag) return 'Escribe el ID del equipo.';
  if (tag.length > ASSET_TAG_MAX_LENGTH) return `El ID del equipo admite hasta ${ASSET_TAG_MAX_LENGTH} caracteres.`;
  if (!ALLOWED.test(tag))
    return 'El ID del equipo solo admite letras, números, espacios y los signos - _ . / (sin tildes ni ñ).';
  return null;
}
