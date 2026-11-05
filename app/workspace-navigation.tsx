'use client';
import './workspaces.css';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import { workspaceFetch,currentWorkspaceId } from '@/lib/workspace-client';
import { workspaceHome } from '@/lib/workspace-model';
import {workspaceRoleLabel,workspaceStateLabel} from '@/lib/workspace-administration-ui';
export function WorkspaceSwitcher(){
 const [items,setItems]=useState<{id:string;brandName:string;role:string;state:string}[]>([]),[error,setError]=useState('');
 useEffect(()=>{let live=true;void workspaceFetch('/api/workspaces',{cache:'no-store'}).then(async response=>{if(!response.ok)throw Error('No se pudieron consultar tus espacios.');const data=await response.json();if(live)setItems(data.workspaces);}).catch(reason=>{if(live)setError(reason.message);});return()=>{live=false;};},[]);
 return <div className="workspace-switcher"><label>Espacio<select aria-label="Cambiar espacio" value={currentWorkspaceId()} onChange={event=>window.location.assign(workspaceHome(event.target.value))}>{items.map(item=><option key={item.id} value={item.id}>{item.brandName} · {workspaceRoleLabel(item.role)} · {workspaceStateLabel(item.state)}</option>)}</select></label>{error&&<p role="alert">{error}</p>}<Link href="/workspaces">Todos mis espacios</Link></div>;
}
