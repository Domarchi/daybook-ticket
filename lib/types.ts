export type TicketStatus = 'open' | 'pending' | 'resolved';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type MessageKind = 'request' | 'reply' | 'note';
export type MemberRole = 'owner' | 'admin' | 'agent' | 'client';
export type MemberStatus = 'invited' | 'active' | 'revoked';
export type CompanyAccess = 'own' | 'manager';
export interface Member {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  hasAccount: boolean;
  customerCompanyId: string | null;
  companyAccess: CompanyAccess;
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
  customerCompanyId: string | null;
  version: number;
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
  authorMemberId: string | null;
  authorRole: MemberRole | null;
  body: string;
  kind: MessageKind;
  createdAt: string;
  attachments: Attachment[];
}
export interface CustomerCompany { id: string; name: string; createdAt: string; updatedAt: string }
export interface SavedReply { id: string; title: string; category: string; body: string; createdAt: string; updatedAt: string }
export interface TicketEvent { id: string; ticketId: number; actorMemberId: string | null; actorName: string; action: string; beforeValue: string | null; afterValue: string | null; createdAt: string }
export interface Attachment { id: string; name: string; size: number; contentType: string }
export interface TicketAlert {
  id: string;
  event: 'ticket_created' | 'agent_replied' | 'client_replied';
  ticketId: number;
  subject: string;
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
  notificationMemberIds: string[];
  departments: string[];
  slaHours: Record<TicketPriority, number>;
}
export interface Workspace {
  viewer: Member | null;
  members: Member[];
  mailStatus: MailStatus | null;
  tickets: Ticket[];
  messages: Message[];
  alerts: TicketAlert[];
  articles: Article[];
  companies: CustomerCompany[];
  savedReplies: SavedReply[];
  settings: Settings;
  demoLoaded: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  brandName: 'Daybook Ticket',
  tagline: 'Un servicio Daybook. Cada conversación, una solución.',
  agents: ['Yo'],
  notificationMemberIds: [],
  departments: ['Soporte técnico', 'Facturación', 'Ventas'],
  slaHours: { urgent: 4, high: 8, normal: 24, low: 72 },
};
