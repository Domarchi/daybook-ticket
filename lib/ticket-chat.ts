import type { Message } from './types';

export const CHAT_TIME_ZONE = 'America/Santiago';
const dayParts = new Intl.DateTimeFormat('en-CA', { timeZone: CHAT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayLabel = new Intl.DateTimeFormat('es-CL', { timeZone: CHAT_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeLabel = new Intl.DateTimeFormat('es-CL', { timeZone: CHAT_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function timestamp(value: string): number {
  const valueOf = Date.parse(value);
  return Number.isFinite(valueOf) ? valueOf : 0;
}

export function compareChatMessages(left: Message, right: Message): number {
  return timestamp(left.createdAt) - timestamp(right.createdAt) || left.id - right.id;
}

/** Filtering precedes every display, search and new-message calculation. */
export function visibleChatMessages(messages: Message[], staff: boolean): Message[] {
  return messages.filter(message => staff || message.kind !== 'note').map(message=>{const privateQuote=message.quote?.kind==='note'&&(message.kind!=='note'||!staff);const privateMentions=!staff&&Boolean(message.mentions?.length);return privateQuote||privateMentions?{...message,...(privateQuote?{quote:null}:{}),...(privateMentions?{mentions:[]}: {})}:message;}).sort(compareChatMessages);
}

export function chatDayKey(createdAt: string): string {
  if (!Number.isFinite(Date.parse(createdAt))) return 'unknown';
  const parts = dayParts.formatToParts(new Date(createdAt));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}

export function chatDateLabel(createdAt: string): string {
  return Number.isFinite(Date.parse(createdAt)) ? dayLabel.format(new Date(createdAt)) : 'Fecha no disponible';
}

export function chatTimeLabel(createdAt: string): string {
  return Number.isFinite(Date.parse(createdAt)) ? timeLabel.format(new Date(createdAt)) : '—';
}

export function groupChatMessages(messages: Message[]): { key: string; label: string; messages: Message[] }[] {
  const groups: { key: string; label: string; messages: Message[] }[] = [];
  for (const message of messages) {
    const key = chatDayKey(message.createdAt);
    const previous = groups.at(-1);
    if (previous?.key === key) previous.messages.push(message);
    else groups.push({ key, label: chatDateLabel(message.createdAt), messages: [message] });
  }
  return groups;
}

function searchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
}

/** This deliberately searches only the already-authorized, loaded messages. */
export function findChatMatches(messages: Message[], query: string, staff: boolean): number[] {
  const needle = searchText(query.slice(0, 160));
  if (!needle) return [];
  return visibleChatMessages(messages, staff).filter(message => searchText([
    message.author, message.body, ...message.attachments.map(attachment => attachment.name),
  ].join('\n')).includes(needle)).map(message => message.id);
}

/** Older pagination and repeated snapshots must not count as incoming messages. */
export function appendedChatMessages(previous: Message[], current: Message[]): Message[] {
  if (!previous.length) return [];
  const knownIds = new Set(previous.map(message => message.id));
  const tail = previous.reduce((last, message) => compareChatMessages(last, message) < 0 ? message : last);
  return current.filter(message => !knownIds.has(message.id) && compareChatMessages(message, tail) > 0);
}

export function chatAuthorRole(message: Message): string {
  if (message.kind === 'note') return 'Nota interna';
  if (message.authorRole === 'client') return 'Cliente';
  if (message.authorRole === 'owner' || message.authorRole === 'admin' || message.authorRole === 'agent') return 'Equipo Daybook';
  return message.kind === 'request' ? 'Solicitud' : 'Mensaje';
}
