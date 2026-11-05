import { z } from 'zod';
import { db } from './server';
export const preferencesSchema = z.object({ theme: z.enum(['system','light','dark']) }).strict();
export async function getUserPreferences(userId:string):Promise<{theme:'system'|'light'|'dark'}> {
  try { return (await db().prepare('SELECT theme FROM "userPreferences" WHERE "userId"=$1').bind(userId).first<{theme:'system'|'light'|'dark'}>()) ?? {theme:'system'}; }
  catch(error) { if((error as {code?:string}).code==='42P01') return {theme:'system'}; throw error; }
}
export async function saveUserPreferences(userId:string,input:z.infer<typeof preferencesSchema>) {
  await db().prepare('INSERT INTO "userPreferences" ("userId",theme,"updatedAt") VALUES ($1,$2,$3) ON CONFLICT ("userId") DO UPDATE SET theme=EXCLUDED.theme,"updatedAt"=EXCLUDED."updatedAt"').bind(userId,input.theme,new Date().toISOString()).run();
  return input;
}
