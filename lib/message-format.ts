export type MessageFormat = 'plain' | 'markdown';
export type InlinePart = { type: 'text' | 'bold' | 'italic' | 'code' | 'link'; text: string; href?: string };

/** Only explicit, safe links. HTML, remote images and executable URL schemes stay text. */
export function safeMessageLink(value: string): string | null {
  if (value.length > 2048 || /[\u0000-\u0020\u007f]|%0[0-9a-f]|%1[0-9a-f]|%7f/i.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function messageInlineParts(text: string): InlinePart[] {
  // Exclude nested open brackets: unmatched prefixes must not rescan the rest of the message.
  const expression = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`|\[([^\]\[\n]{1,256})\]\(([^)\s\[\](]{1,2048})\)/g;
  const parts: InlinePart[] = [];
  let start = 0;
  for (const match of text.matchAll(expression)) {
    if (match.index! > start) parts.push({ type: 'text', text: text.slice(start, match.index) });
    if (match[1]) parts.push({ type: 'bold', text: match[1] });
    else if (match[2]) parts.push({ type: 'italic', text: match[2] });
    else if (match[3]) parts.push({ type: 'code', text: match[3] });
    else {
      const href = safeMessageLink(match[5]);
      parts.push(href ? { type: 'link', text: match[4], href } : { type: 'text', text: match[0] });
    }
    start = match.index! + match[0].length;
    if (parts.length > 1000) return [{ type: 'text', text }];
  }
  if (start < text.length) parts.push({ type: 'text', text: text.slice(start) });
  return parts;
}

export type MessageBlock = { type: 'paragraph' | 'unordered' | 'ordered'; lines: string[] };
export function messageBlocks(body: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const lines = body.split(/\r?\n/);
  if (lines.length > 1000) return [{ type: 'paragraph', lines: [body] }];
  for (const line of lines) {
    const unordered = /^\s*[-*] (.*)$/.exec(line), ordered = /^\s*\d{1,4}[.)] (.*)$/.exec(line);
    const type = unordered ? 'unordered' : ordered ? 'ordered' : 'paragraph';
    const content = unordered?.[1] ?? ordered?.[1] ?? line;
    const previous = blocks.at(-1);
    if (previous?.type === type) previous.lines.push(content);
    else blocks.push({ type, lines: [content] });
  }
  return blocks;
}

export function formatSelection(body: string, start: number, end: number, action: 'bold' | 'italic' | 'code' | 'link' | 'list' | 'ordered') {
  const selected = body.slice(start, end);
  const wrappers = { bold: ['**', '**'], italic: ['*', '*'], code: ['`', '`'], link: ['[', '](https://)'] } as const;
  if (action === 'list' || action === 'ordered') {
    const lineStart = start === 0 ? 0 : body.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = body.indexOf('\n', end) === -1 ? body.length : body.indexOf('\n', end);
    const replacement = body.slice(lineStart, lineEnd).split('\n').map((line, i) => `${action === 'list' ? '- ' : `${i + 1}. `}${line}`).join('\n');
    return { body: body.slice(0, lineStart) + replacement + body.slice(lineEnd), start: lineStart, end: lineStart + replacement.length };
  }
  const [prefix, suffix] = wrappers[action];
  const value = selected || (action === 'link' ? 'texto del enlace' : 'texto');
  return { body: body.slice(0, start) + prefix + value + suffix + body.slice(end), start: start + prefix.length, end: start + prefix.length + value.length };
}
