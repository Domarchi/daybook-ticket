type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** Same comparison as the server for object key order, without changing arrays,
 * omitted fields, nulls or the actual payload sent by older browsers. */
export function canonicalDraftPayload(value:unknown):string {
  const json=JSON.stringify(value);
  if(json===undefined)return 'undefined';
  const sort=(item:unknown):unknown=>Array.isArray(item)?item.map(sort):item&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,sort((item as Record<string,unknown>)[key])])):item;
  return JSON.stringify(sort(JSON.parse(json)));
}
export class DraftOperations {
  private readonly values = new Map<string, { payload: string; id: string }>();
  constructor(private readonly storage: StoragePort | null, private readonly uuid = () => crypto.randomUUID()) {}
  previous(scope: string): { id: string; payload: unknown } | null {
    const key = `daybook.ticket.operation.v1.${scope}`;
    try {const stored=this.values.get(key)||JSON.parse(this.storage?.getItem(key)||'null');if(stored&&typeof stored.id==='string'&&typeof stored.payload==='string')return {id:stored.id,payload:JSON.parse(stored.payload)};}catch{/* Unreadable attempts are not reused. */}
    return null;
  }
  forPayload(scope: string, payload: unknown): string {
    const previous=this.previous(scope);
    if(previous&&canonicalDraftPayload(previous.payload)===canonicalDraftPayload(payload))return previous.id;
    const next={payload:JSON.stringify(payload),id:this.uuid()},key=`daybook.ticket.operation.v1.${scope}`;
    this.values.set(key,next);try{this.storage?.setItem(key,JSON.stringify(next));}catch{/* Keep the same ID for current-page retries. */}return next.id;
  }
  clear(scope:string){const key=`daybook.ticket.operation.v1.${scope}`;this.values.delete(key);try{this.storage?.removeItem(key);}catch{/* Changed content gets a new operation. */}}
}
let browserOperations:DraftOperations|undefined;
export function getDraftOperations(){if(typeof window==='undefined')return new DraftOperations(null);if(!browserOperations){let storage:Storage|null=null;try{storage=window.sessionStorage;}catch{/* Storage is optional. */}browserOperations=new DraftOperations(storage);}return browserOperations;}
