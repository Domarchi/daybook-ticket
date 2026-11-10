import { z } from 'zod';
import { requireStaff } from '@/lib/access';
import { requireServiceContextAccess } from '@/lib/service-context-access';
import { handle, json, parseBody } from '@/lib/server';
import { updateServiceContext, saveServiceReminderConfig, markServiceReminderRead } from '@/lib/service-context';
type Context = { params: Promise<{ resource: string; id: string }> };
export async function PATCH(request: Request, context: Context) {
  return handle(async () => {
    const access = requireStaff(await requireServiceContextAccess(request)),
      { resource, id } = await context.params;
    if (resource === 'config' && id === 'current')
      return json(
        await saveServiceReminderConfig(
          access,
          await parseBody(
            request,
            z.object({ expectedVersion: z.number().int().min(0), enabled: z.boolean() }).strict(),
          ),
        ),
      );
    if (resource === 'reminders') {
      await parseBody(request, z.object({ read: z.literal(true) }).strict());
      return json(await markServiceReminderRead(access, id));
    }
    return json(
      await updateServiceContext(access, resource, id, await parseBody(request, z.record(z.string(), z.unknown()))),
    );
  });
}
