import { z } from 'zod';
import { handle, json, auth, db, parseBody } from '@/lib/server';
import { acceptInvitation } from '@/lib/invitations';
export async function POST(request: Request) {
  return handle(async () => {
    const user = await auth(request),
      body = await parseBody(request, z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict());
    return json(await acceptInvitation(db(), body.token, user));
  });
}
