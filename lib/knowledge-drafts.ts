import {workspaceStorageKey} from './workspace-client';
type StoragePort=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export interface KnowledgeDraft {baseVersion:number;title:string;category:string;body:string;changeNote:string}
export const knowledgeDraftKey=(memberId:string,articleId:number)=>workspaceStorageKey(`daybook.knowledge.draft.v1.${encodeURIComponent(memberId)}.${articleId}`);
export class KnowledgeDraftStore {
 private readonly memory=new Map<string,KnowledgeDraft>();
 constructor(private readonly storage:StoragePort|null){}
 read(memberId:string,articleId:number,fallback:KnowledgeDraft):KnowledgeDraft {
  const key=knowledgeDraftKey(memberId,articleId),cached=this.memory.get(key);if(cached)return {...cached};
  try{const value=JSON.parse(this.storage?.getItem(key)||'null');if(value&&Number.isInteger(value.baseVersion)&&value.baseVersion>=0&&['title','category','body','changeNote'].every(field=>typeof value[field]==='string')&&value.title.length<=180&&value.category.length<=100&&value.body.length<=40000&&value.changeNote.length<=1000){this.memory.set(key,value);return {...value};}}catch{/* Keep a scoped in-memory draft when browser storage is unavailable. */}
  return {...fallback};
 }
 write(memberId:string,articleId:number,value:KnowledgeDraft){const key=knowledgeDraftKey(memberId,articleId);this.memory.set(key,{...value});try{this.storage?.setItem(key,JSON.stringify(value));}catch{/* The current-page draft remains recoverable. */}return value;}
 clear(memberId:string,articleId:number){const key=knowledgeDraftKey(memberId,articleId);this.memory.delete(key);try{this.storage?.removeItem(key);}catch{/* Optional browser persistence. */}}
}
