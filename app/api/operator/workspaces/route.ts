import { z } from 'zod';
import { handle, json, parseBody } from '@/lib/server';
import { createPilot, listPlatformWorkspaces, requireOperator } from '@/lib/workspaces';
import { limitsSchema } from '@/lib/workspace-model';
export async function GET(request: Request) {
  return handle(async () => {
    await requireOperator(request);
    return json({ workspaces: await listPlatformWorkspaces() });
  });
}
export async function POST(request: Request) {
  return handle(async () => {
    const actor = await requireOperator(request, true);
    const input = await parseBody(
      request,
      z
        .object({
          name: z.string().trim().min(1).max(120),
          ownerName: z.string().trim().min(1).max(120),
          ownerEmail: z
            .string()
            .trim()
            .email()
            .max(254)
            .transform(x => x.toLowerCase()),
          limits: limitsSchema,
        })
        .strict(),
    );
    return json(await createPilot(input, undefined, actor), 201);
  });
}
