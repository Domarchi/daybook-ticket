import { workspaceApiPath,workspaceIdFromPath } from './workspace-model';
export function currentWorkspaceId(){return typeof window==='undefined'?'daybook':workspaceIdFromPath(window.location.pathname);}
/** Per call and per tab. There is no mutable global workspace, cookie, or selected-space storage. */
export const workspaceFetch:typeof fetch=(input,init)=>{
  const path=typeof input==='string'?workspaceApiPath(input,currentWorkspaceId()):input;
  return fetch(path,init);
};
export function workspaceStorageKey(key:string,workspaceId=currentWorkspaceId()){return workspaceId==='daybook'?key:`daybook.workspace.${workspaceId}.${key}`;}
