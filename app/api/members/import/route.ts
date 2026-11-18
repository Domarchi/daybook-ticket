import { z } from 'zod';
import { requireAccess, requireAdmin } from '@/lib/access';
import { applyMemberImport, previewMemberImport } from '@/lib/member-import';
import { IMPORT_MAX_CHARS } from '@/lib/member-import-model';
import { consumeRateLimit, RATE_RULES } from '@/lib/rate-limit';
import { handle, json, parseBody } from '@/lib/server';

/** Up to 500 rows in one transaction. */
export const maxDuration = 60;

const importSchema = z
  .object({
    mode: z.enum(['preview', 'apply']),
    csv: z.string().max(IMPORT_MAX_CHARS, 'El archivo es demasiado grande. Divídelo en partes de hasta 500 personas.'),
    createMissingCompanies: z.boolean(),
  })
  .strict();

/**
 * Bulk import of client employees with their equipment (Fase 7). «preview» writes nothing; «apply» creates everything
 * or nothing and answers the invitation links once. Admins only; like every write under /api/members it requires a
 * recent password check (428 otherwise). No invitation mail is queued.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    await consumeRateLimit(access, RATE_RULES.memberImport);
    const body = await parseBody(request, importSchema, IMPORT_MAX_CHARS + 50_000);
    const input = { csv: body.csv, createMissingCompanies: body.createMissingCompanies };
    if (body.mode === 'preview') return json(await previewMemberImport(access, input));
    const result = await applyMemberImport(access, input);
    if ('blocked' in result)
      return json(
        {
          error: 'El archivo tiene filas con problemas. Revísalo de nuevo antes de crear las invitaciones.',
          preview: result.blocked,
        },
        409,
      );
    return json(result, 201);
  });
}
