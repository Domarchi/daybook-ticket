/** Work is bounded by the provider response limit before this module is called. */
export function htmlToInboundText(html: string): string {
  const chunks: string[] = [], lower = html.toLowerCase();
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start < 0) { chunks.push(html.slice(cursor)); break; }
    chunks.push(html.slice(cursor, start));
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      if (end < 0) break;
      cursor = end + 3; continue;
    }
    const end = html.indexOf('>', start + 1);
    if (end < 0) { chunks.push(html.slice(start)); break; }
    const tag = html.slice(start + 1, Math.min(end, start + 8193));
    const name = /^\s*(\/?)\s*([a-z][a-z0-9]*)/i.exec(tag);
    if (name && !name[1] && ['script','style','head'].includes(name[2].toLowerCase())) {
      const close = lower.indexOf(`</${name[2].toLowerCase()}`, end + 1);
      if (close < 0) break;
      const closeEnd = html.indexOf('>', close);
      cursor = closeEnd < 0 ? html.length : closeEnd + 1; continue;
    }
    if (name && (name[2].toLowerCase() === 'br' || (name[1] && /^(?:p|div|li|tr|h[1-6])$/i.test(name[2])))) chunks.push('\n');
    cursor = end + 1;
  }
  return chunks.join('').replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]{1,6}|[0-9]{1,7});/gi, entity => {
      const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
      if (named[entity.toLowerCase()] !== undefined) return named[entity.toLowerCase()];
      const code = entity.toLowerCase().startsWith('&#x') ? Number.parseInt(entity.slice(3, -1), 16) : Number.parseInt(entity.slice(2, -1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
    }).replace(/\n[\t ]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function unquotedInboundText(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let end = lines.length;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*>/.test(line) || /^\s*-{2,}\s*(?:Original Message|Mensaje original)\s*-{2,}\s*$/i.test(line)) { end = index; break; }
    // Gmail wraps an attribution across several short lines. Require both its
    // localized opening AND closing, in a bounded window, not arbitrary prose.
    if (/^\s*(?:On|El)\s+\S/i.test(line)) {
      let attribution = '';
      for (let last = index; last < Math.min(lines.length, index + 6); last++) {
        if (lines[last].length > 500 || attribution.length > 1500) break;
        attribution += ` ${lines[last].trim()}`;
        if (/\s(?:wrote|escribi[oó]):\s*$/i.test(attribution)
          && (/[\d@<>]|\b(?:mon|tue|wed|thu|fri|sat|sun|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i.test(attribution)
            || /^\s*>/.test(lines[last + 1] || ''))) { end = index; break; }
      }
      if (end !== lines.length) break;
    }
    // Outlook's localized quoted header block, only after a separator/blank.
    if ((index === 0 || !lines[index - 1].trim()) && /^\s*(?:From|De):\s+\S/i.test(line)) {
      const block = lines.slice(index, index + 6).join('\n');
      if (/^\s*(?:Sent|Enviado):/mi.test(block) && /^\s*(?:To|Para):/mi.test(block) && /^\s*(?:Subject|Asunto):/mi.test(block)) { end = index; break; }
    }
  }
  return lines.slice(0, end).join('\n').trim();
}

export function normalizeInboundBody(text: string | null | undefined, html: string | null | undefined): string {
  if (text?.trim()) return unquotedInboundText(text);
  const input = html || '';
  // Cut at mail-client-specific quote containers. Generic blockquotes can be
  // authored by the customer and are deliberately retained as inert text.
  let cursor = 0, quote = input.length;
  while (cursor < input.length) {
    const start = input.indexOf('<', cursor);
    if (start < 0) break;
    const end = input.indexOf('>', start + 1);
    if (end < 0) break;
    if (end - start <= 4096) {
      const tag = input.slice(start, end + 1);
      if (/^<(?:div|blockquote)\b/i.test(tag) && /\b(?:class\s*=\s*["'][^"']*\b(?:gmail_quote|yahoo_quoted|protonmail_quote)\b[^"']*["']|id\s*=\s*["'](?:divRplyFwdMsg|appendonsend)["']|type\s*=\s*["']cite["'])/i.test(tag)) { quote = start; break; }
    }
    cursor = end + 1;
  }
  return unquotedInboundText(htmlToInboundText(input.slice(0, quote)));
}
