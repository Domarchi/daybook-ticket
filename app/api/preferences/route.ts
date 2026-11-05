import {auth,handle,json,parseBody} from '@/lib/server';
import {getUserPreferences,saveUserPreferences,preferencesSchema} from '@/lib/user-preferences';
export const dynamic='force-dynamic';
export async function GET(request:Request){return handle(async()=>json(await getUserPreferences((await auth(request)).userId)));}
export async function PUT(request:Request){return handle(async()=>json(await saveUserPreferences((await auth(request)).userId,await parseBody(request,preferencesSchema))));}
