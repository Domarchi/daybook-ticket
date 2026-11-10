'use client';
import { readDaybookJson } from '@/lib/browser-json';
import { UNCERTAIN_SEND_MESSAGE, daybookFetch } from '@/lib/browser-request';
import { domainResponseValidator } from '@/lib/domain-response';
import { Inbox, X } from 'lucide-react';
import { deskQuery, type View } from '@/lib/desk-url';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { type Message, type Ticket, type TicketPriority, type TicketStatus } from '../../lib/types';

export const STATUS: Record<TicketStatus, string> = { open: 'Abierto', pending: 'En espera', resolved: 'Resuelto' };
export const PRIORITY: Record<TicketPriority, string> = { urgent: 'Urgente', high: 'Alta', normal: 'Normal', low: 'Baja' };
export type { View };
export const views: Record<View, string> = { inbox: 'Bandeja de entrada', overview: 'Resumen', contacts: 'Contactos', knowledge: 'Conocimiento', team: 'Equipo y clientes', settings: 'Configuración', portal: 'Centro de ayuda', operations: 'Atención y reparto', metrics: 'Métricas del equipo', service:'Empresas y servicios',reports:'Informes por empresa',security:'Seguridad de mi cuenta' };
export function initials(name: string) { return name.split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase(); }
export function fmtDate(s: string) { return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(s)); }
export function since(s: string, now: number) { const n = Math.max(0, (now - Date.parse(s)) / 60000); return n < 1 ? 'Ahora' : n < 60 ? `${Math.floor(n)} min` : n < 1440 ? `${Math.floor(n / 60)} h` : `${Math.floor(n / 1440)} d`; }
export function sla(t: Ticket, now: number) { const mins = Math.round((Date.parse(t.dueAt) - now) / 60000); return t.status === 'resolved' ? 'Completado' : mins < 0 ? 'Vencido' : mins < 60 ? `${mins} min restantes` : `${Math.floor(mins / 60)} h restantes`; }
export function Avatar({ name, small = false }: {
    name: string;
    small?: boolean;
}) { return <span className={`avatar ${small ? 'small' : ''}`} style={{ background: ['#e5e8fa', '#e4eee5', '#f7e8dc', '#e7edf2'][name.length % 4] }}>{initials(name) || '?'}</span>; }
export function Status({ status }: {
    status: TicketStatus;
}) { return <span className={`status ${status}`}><span />{STATUS[status]}</span>; }
export function Priority({ priority }: {
    priority: TicketPriority;
}) { return <span className={`priority ${priority}`}><span className="bars"><i /><i /><i /></span>{PRIORITY[priority]}</span>; }
export async function request<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await daybookFetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined },method==='GET'?undefined:UNCERTAIN_SEND_MESSAGE);
    return readDaybookJson(response,{mutation:method!=='GET',validate:domainResponseValidator<T>(path,method)});
}
export function Modal({ title, children, onClose, wide = false, error }: {
    title: string;
    children: ReactNode;
    onClose: () => void;
    wide?: boolean;
    error?: string;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    useEffect(() => {
        // The native dialog traps focus. Lock the page behind it and give focus back on close.
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        ref.current?.showModal();
        return () => { document.body.style.overflow = previousOverflow; if (opener?.isConnected) opener.focus(); };
    }, []);
    return <dialog ref={ref} aria-labelledby={titleId} className={`modal ${wide ? 'wide' : ''}`} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget)
    onClose(); }}><div className="modal-head"><div><span className="eyebrow">TU CENTRO DE SOPORTE</span><h2 id={titleId}>{title}</h2></div><button aria-label="Cerrar" className="icon-button" onClick={onClose}><X size={20}/></button></div>{error && <div className="modal-error" role="alert">{error}</div>}{children}</dialog>; }
// The search shortcut is Cmd+K on Apple devices and Ctrl+K elsewhere (the handler accepts both).
const isApplePlatform = () => /Mac|iPhone|iPad/i.test(navigator.userAgent);
export function SearchShortcut() { const apple = useSyncExternalStore(() => () => {}, isApplePlatform, () => true); return <kbd>{apple ? '⌘ K' : 'Ctrl K'}</kbd>; }
export function Empty({ title, children, action }: {
    title: string;
    children: ReactNode;
    action?: ReactNode;
}) { return <div className="empty"><span className="empty-icon"><Inbox size={27}/></span><h3>{title}</h3><p>{children}</p>{action}</div>; }
export function Stat({ label, value, icon, detail, color }: {
    label: string;
    value: number;
    icon: ReactNode;
    detail: string;
    color: string;
}) { return <article className="stat-card"><div><span>{label}</span><span className={`stat-icon ${color}`}>{icon}</span></div><strong>{value.toString().padStart(2, '0')}</strong><small>{detail}</small></article>; }
export function PageTitle({ title, subtitle, action }: {
    title: string;
    subtitle: string;
    action?: ReactNode;
}) { return <div className="page-heading"><div><span className="eyebrow"><span className="tiny-line"/> TU ESPACIO, BIEN ORGANIZADO</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>; }
export type DeskRun = (fn: () => Promise<unknown>, message: string) => Promise<boolean>;
export type ReplyTarget = { memberId: string; ticketId: number; message: Message } | null;

/**
 * A real link to a desk location. A plain click is handled in place (no page load); modified clicks
 * (new tab, new window, download) keep the browser's own behavior, which the old buttons did not allow.
 */
export function DeskLink({ to, onNavigate, className, children, ...rest }: {
    to: { view?: View; ticketId?: number | null };
    onNavigate: () => void;
    className?: string;
    children: ReactNode;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick' | 'className' | 'children'>) {
    const pathname = usePathname() ?? '';
    return <a {...rest} className={className} href={`${pathname}${deskQuery(to)}`} onClick={event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate();
    }}>{children}</a>;
}
