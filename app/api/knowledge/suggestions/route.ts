import {requireKnowledgeAccess} from '@/lib/knowledge-access';
import { ApiError,handle,json } from '@/lib/server';
import { listKnowledge } from '@/lib/knowledge';
export async function GET(request:Request){return handle(async()=>{const access=await requireKnowledgeAccess(request),params=new URL(request.url).searchParams,q=(params.get('q')||'').trim();if([...params.keys()].some(key=>key!=='q'||params.getAll(key).length!==1)||q.length>160)throw new ApiError(400,'La búsqueda no es válida.');return json(q.length<3?{items:[],nextCursor:null}:await listKnowledge(access,{q,limit:5}));});}
