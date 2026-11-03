export type TicketStatus = 'open' | 'pending' | 'resolved';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type MessageKind = 'request' | 'reply' | 'note';
export type MemberRole = 'owner' | 'admin' | 'agent' | 'client';
export type MemberStatus = 'invited' | 'active' | 'revoked';
export interface Member {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  hasAccount: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface MailStatus {
  configured: boolean;
  sender: string | null;
  counts: Record<string, number>;
  lastError?: string;
}
export interface Ticket {
  id: number;
  subject: string;
  requesterName: string;
  requesterEmail: string;
  requesterMemberId: string | null;
  department: string;
  assignee: string;
  assigneeMemberId: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  createdAt: string;
  updatedAt: string;
  dueAt: string;
}
export interface Message {
  id: number;
  ticketId: number;
  author: string;
  body: string;
  kind: MessageKind;
  createdAt: string;
}
export interface Article {
  id: number;
  title: string;
  category: string;
  body: string;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface Settings {
  brandName: string;
  tagline: string;
  agents: string[];
  departments: string[];
  slaHours: Record<TicketPriority, number>;
}
export interface Workspace {
  viewer: Member | null;
  members: Member[];
  mailStatus: MailStatus | null;
  tickets: Ticket[];
  messages: Message[];
  articles: Article[];
  settings: Settings;
  demoLoaded: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  brandName: 'Daybook Ticket',
  tagline: 'Un servicio Daybook. Cada conversación, una solución.',
  agents: ['Yo'],
  departments: ['Soporte técnico', 'Facturación', 'Ventas'],
  slaHours: { urgent: 4, high: 8, normal: 24, low: 72 },
};
