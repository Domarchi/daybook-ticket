'use client';
import {daybookFetch} from '@/lib/browser-request';
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Files, LoaderCircle, Search, Star, X } from 'lucide-react';
import { readTicketResource } from '@/hooks/use-ticket-search';
import { MessageContent } from './message-content';
import { MessageAttachments } from './attachments';
import type { Attachment, Message } from '@/lib/types';

type SearchHit={id:number;author:string;kind:string;createdAt:string;excerpt:string};
type FileHit=Attachment&{createdAt:string;messageId:number;kind:string;author:string};
type MessageContextResponse={messages:Message[];anchorId:number;previousAnchorId:number|null;nextAnchorId:number|null};
type Page<T>={items:T[];total:number;nextCursor:string|null};
const date=(value:string)=>new Intl.DateTimeFormat('es-CL',{timeZone:'America/Santiago',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));

function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}) {
 const dialog=useRef<HTMLDialogElement>(null),id=useId();
 useEffect(()=>{dialog.current?.showModal();},[]);
 return <dialog ref={dialog} className="ticket-collaboration-dialog" aria-labelledby={id} onCancel={event=>{event.preventDefault();onClose();}}><header><h3 id={id}>{title}</h3><button type="button" className="ticket-chat-icon-button" aria-label="Cerrar ventana" onClick={onClose}><X size={20}/></button></header>{children}</dialog>;
}

export function TicketCollaborationTools({ticketId,memberId,staff,onOpenMessage}:{ticketId:number;memberId:string;staff:boolean;onOpenMessage:(id:number)=>void}) {
 const [mode,setMode]=useState<'search'|'files'|null>(null),[query,setQuery]=useState(''),[type,setType]=useState('all'),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const [follow,setFollow]=useState<{following:boolean;followers:{memberId:string;name:string}[]}|null>(null),[followingBusy,setFollowingBusy]=useState(false),[followError,setFollowError]=useState('');
 const parameters=new URLSearchParams(mode==='search'?{q:query,limit:'20'}:{q:query,type,...(from?{from}:{}),...(to?{to}:{})}).toString();
 const key=`${memberId}:${ticketId}:${mode}:${parameters}`,activeKey=useRef(key);
 const [state,setState]=useState<{key:string;page:Page<SearchHit|FileHit>;error:string;loadingMore:boolean}>({key:'',page:{items:[],total:0,nextCursor:null},error:'',loadingMore:false});
 useEffect(()=>{
   if(!staff)return;const controller=new AbortController();
   void readTicketResource<{following:boolean;followers:{memberId:string;name:string}[]}>(`/api/tickets/${ticketId}/followers`,memberId,controller.signal).then(value=>{if(!controller.signal.aborted)setFollow(value);}).catch(error=>{if(!controller.signal.aborted)setFollowError(error instanceof Error?error.message:'No se pudo consultar el seguimiento.');});
   return()=>controller.abort();
 },[memberId,ticketId,staff]);
 useEffect(()=>{
   activeKey.current=key;if(!mode || mode==='search'&&!query.trim())return;
   const controller=new AbortController(),timer=setTimeout(async()=>{
     try{const page=await readTicketResource<Page<SearchHit|FileHit>>(`/api/tickets/${ticketId}/${mode==='search'?'messages/search':'files'}?${parameters}`,memberId,controller.signal);if(!controller.signal.aborted)setState({key,page,error:'',loadingMore:false});}
     catch(error){if(!controller.signal.aborted)setState({key,page:{items:[],total:0,nextCursor:null},error:error instanceof Error?error.message:'No se pudo cargar.',loadingMore:false});}
   },query?250:0);
   return()=>{clearTimeout(timer);controller.abort();};
 },[key,mode,parameters,memberId,ticketId,query]);
 const page=state.key===key?state.page:{items:[],total:0,nextCursor:null};
 const loading=Boolean(mode&&(mode==='files'||query.trim())&&state.key!==key);
 const show=(next:'search'|'files')=>{setQuery('');setType('all');setFrom('');setTo('');setMode(next);};
 const openMessage=(id:number)=>{setMode(null);requestAnimationFrame(()=>onOpenMessage(id));};
 const more=async()=>{
   if(!mode||!page.nextCursor||state.loadingMore)return;setState(previous=>({...previous,loadingMore:true}));
   try{const response=await readTicketResource<Page<SearchHit|FileHit>>(`/api/tickets/${ticketId}/${mode==='search'?'messages/search':'files'}?${parameters}&cursor=${encodeURIComponent(page.nextCursor)}`,memberId);
     if(activeKey.current===key)setState(previous=>({...previous,page:{...response,items:[...previous.page.items,...response.items]},loadingMore:false}));
   }catch(error){if(activeKey.current===key)setState(previous=>({...previous,loadingMore:false,error:error instanceof Error?error.message:'No se pudo cargar la siguiente página.'}));}
 };
 return <>
  <button type="button" className="ticket-chat-icon-button" aria-label="Buscar en toda la conversación" title="Buscar en toda la conversación" onClick={()=>show('search')}><Search size={19}/></button>
  <button type="button" className="ticket-chat-icon-button" aria-label="Archivos del ticket" title="Archivos del ticket" onClick={()=>show('files')}><Files size={19}/></button>
  {staff&&<button type="button" className="ticket-chat-icon-button" aria-label={follow?.following?'Dejar de seguir el ticket':'Seguir el ticket'} title={followError|| (follow?.following?'Sigues las actualizaciones públicas de este ticket':'Seguir sin cambiar al responsable')} aria-pressed={Boolean(follow?.following)} disabled={followingBusy||!follow} onClick={async()=>{
    if(!follow)return;setFollowingBusy(true);setFollowError('');
    try{const response=await daybookFetch(`/api/tickets/${ticketId}/followers`,{method:'PUT',headers:{'Content-Type':'application/json','X-Daybook-Member-Id':memberId},body:JSON.stringify({following:!follow.following})});const value=await response.json();if(!response.ok)throw new Error(value.error||'No se pudo guardar el seguimiento.');setFollow(value);}
    catch(error){setFollowError(error instanceof Error?error.message:'No se pudo guardar.');}finally{setFollowingBusy(false);}
  }}>{followingBusy?<LoaderCircle className="spin" size={18}/>:<Star size={18} fill={follow?.following?'currentColor':'none'}/>}</button>}
  {followError&&<span className="sr-only" role="alert">{followError}</span>}
  {mode&&<Modal title={mode==='search'?'Buscar en toda la conversación':'Archivos del ticket'} onClose={()=>setMode(null)}>
    <div className="ticket-collaboration-filters"><label>{mode==='search'?'Texto, autor o nombre de archivo':'Buscar archivo'}<input autoFocus value={query} maxLength={200} onChange={event=>setQuery(event.target.value)} placeholder={mode==='search'?'Incluye todos los mensajes que puedes consultar…':'Nombre del archivo…'}/></label>
    {mode==='files'&&<><label>Tipo<select value={type} onChange={event=>setType(event.target.value)}><option value="all">Todos</option><option value="image">Imágenes</option><option value="pdf">PDF</option><option value="document">Documentos</option></select></label><label>Desde<input type="date" value={from} max={to||undefined} onChange={event=>setFrom(event.target.value)}/></label><label>Hasta<input type="date" value={to} min={from||undefined} onChange={event=>setTo(event.target.value)}/></label></>}
    </div>
    <div className="ticket-collaboration-results" aria-busy={loading}>
      {loading?<p role="status">Buscando…</p>:mode==='search'&&!query.trim()?<p>Escribe para buscar en el historial completo del ticket.</p>:<><p className="ticket-collaboration-count" role="status">{page.total} {mode==='search'?'mensajes encontrados':'archivos'} · {page.items.length} cargados</p>
      {state.key===key&&state.error&&<p role="alert">{state.error}</p>}
      {page.items.map(item=>mode==='search'?<button className="ticket-search-hit" type="button" key={item.id} onClick={()=>openMessage(Number(item.id))}><span><strong>{item.author}</strong><time dateTime={item.createdAt}>{date(item.createdAt)}</time></span>{item.kind==='note'&&<small>Nota interna · Solo el equipo</small>}<p>{(item as SearchHit).excerpt}</p><span>Ver mensaje y contexto <ArrowRight size={13}/></span></button>:<article className="ticket-file-hit" key={item.id}><div><strong>{item.author}</strong><time dateTime={item.createdAt}>{date(item.createdAt)}</time>{item.kind==='note'&&<small>Archivo de nota interna · Solo el equipo</small>}</div><MessageAttachments attachments={[item as FileHit]}/><button type="button" className="text-button" onClick={()=>openMessage((item as FileHit).messageId)}>Ver mensaje original <ArrowRight size={13}/></button></article>)}
      {!page.total&&!(state.key===key&&state.error)&&<p>No hay resultados con estos filtros.</p>}
      {page.nextCursor&&<button type="button" className="secondary" disabled={state.loadingMore} onClick={()=>void more()}>{state.loadingMore?'Cargando…':'Cargar más resultados'}</button>}</>}
    </div><footer>Los permisos se comprueban al buscar, abrir y descargar.</footer>
  </Modal>}
 </>;
}

export function TicketMessageContext({ticketId,memberId,messageId,onClose,onReplyTo}:{ticketId:number;memberId:string;messageId:number;onClose:()=>void;onReplyTo?:(message:Message)=>void}) {
 const [anchor,setAnchor]=useState(messageId),[attempt,setAttempt]=useState(0);
 const key=`${memberId}:${ticketId}:${anchor}:${attempt}`;
 const [state,setState]=useState<{key:string;data:MessageContextResponse|null;error:string}>({key:'',data:null,error:''});
 const rows=useRef(new Map<number,HTMLElement>());
 useEffect(()=>{
   const controller=new AbortController();void readTicketResource<MessageContextResponse>(`/api/tickets/${ticketId}/messages/${anchor}`,memberId,controller.signal).then(data=>{
    if(controller.signal.aborted)return;setState({key,data,error:''});requestAnimationFrame(()=>rows.current.get(data.anchorId)?.scrollIntoView({block:'center'}));
   }).catch(error=>{if(!controller.signal.aborted)setState({key,data:null,error:error instanceof Error?error.message:'No se pudo abrir el mensaje.'});});
   return()=>controller.abort();
 },[key,memberId,ticketId,anchor]);
 const data=state.key===key?state.data:null;
 return <Modal title="Mensaje original y contexto" onClose={onClose}>
   {state.key!==key?<p className="ticket-collaboration-status" role="status">Abriendo mensaje…</p>:state.error?<div className="ticket-collaboration-status" role="alert"><p>{state.error}</p><button type="button" className="secondary" onClick={()=>setAttempt(value=>value+1)}>Reintentar</button></div>:data&&<>
    <nav className="ticket-context-navigation" aria-label="Contexto del mensaje"><button type="button" className="secondary" disabled={!data.previousAnchorId} onClick={()=>setAnchor(data.previousAnchorId!)}><ArrowLeft size={14}/>Anteriores</button><button type="button" className="secondary" disabled={!data.nextAnchorId} onClick={()=>setAnchor(data.nextAnchorId!)}>Posteriores<ArrowRight size={14}/></button></nav>
    <div className="ticket-context-messages">{data.messages.map(message=><article ref={node=>{if(node)rows.current.set(message.id,node);else rows.current.delete(message.id);}} key={message.id} className={`ticket-context-message${message.id===anchor?' is-selected':''}${message.kind==='note'?' is-note':''}`}><header><strong>{message.author}</strong><time dateTime={message.createdAt}>{date(message.createdAt)}</time></header>{message.kind==='note'&&<small>Nota interna · Solo el equipo</small>}<MessageContent body={message.body} format={message.bodyFormat}/><MessageAttachments attachments={message.attachments}/>{onReplyTo&&<button type="button" className="text-button" onClick={()=>{onReplyTo(message);onClose();}}>Responder citando</button>}</article>)}</div>
   </>}
 </Modal>;
}
