'use client';
import { Fragment, useRef, useState } from 'react';
import { Bold, Italic, Link, List, ListOrdered, Code, Eye, Pencil } from 'lucide-react';
import { formatSelection, messageBlocks, messageInlineParts, type MessageFormat } from '@/lib/message-format';

function Inline({ text }: { text: string }) {
  return messageInlineParts(text).map((part, index) => part.type === 'bold' ? <strong key={index}>{part.text}</strong>
    : part.type === 'italic' ? <em key={index}>{part.text}</em> : part.type === 'code' ? <code key={index}>{part.text}</code>
    : part.type === 'link' ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer nofollow">{part.text}</a> : <Fragment key={index}>{part.text}</Fragment>);
}
export function MessageContent({ body, format = 'plain' }: { body: string; format?: MessageFormat }) {
  if (format !== 'markdown') return <p className="message-content-plain">{body}</p>;
  return <div className="message-content-rich">{messageBlocks(body).map((block, index) => block.type === 'paragraph'
    ? <p key={index}><Inline text={block.lines.join('\n')}/></p>
    : block.type === 'unordered' ? <ul key={index}>{block.lines.map((line, i) => <li key={i}><Inline text={line}/></li>)}</ul>
      : <ol key={index}>{block.lines.map((line, i) => <li key={i}><Inline text={line}/></li>)}</ol>)}</div>;
}

export function MessageEditor({ value, onChange, label, disabled = false, placeholder, rows = 6, id }: {
  value: string; onChange: (value: string) => void; label: string; disabled?: boolean; placeholder?: string; rows?: number; id?: string;
}) {
  const area = useRef<HTMLTextAreaElement>(null), [preview, setPreview] = useState(false);
  const actions = [{ action: 'bold', label: 'Negrita', icon: Bold }, { action: 'italic', label: 'Cursiva', icon: Italic },
    { action: 'list', label: 'Lista con viñetas', icon: List }, { action: 'ordered', label: 'Lista numerada', icon: ListOrdered },
    { action: 'link', label: 'Insertar enlace', icon: Link }, { action: 'code', label: 'Código', icon: Code }] as const;
  return <div className="message-editor"><div className="message-editor-toolbar" role="toolbar" aria-label={`Formato de ${label.toLowerCase()}`}>
    {actions.map(({ action, label: title, icon: Icon }) => <button key={action} type="button" title={title} aria-label={title} disabled={disabled || preview} onMouseDown={event => event.preventDefault()} onClick={() => {
      const input = area.current;
      const result = formatSelection(value, input?.selectionStart ?? value.length, input?.selectionEnd ?? value.length, action);
      if (result.body.length > 20000) return;
      onChange(result.body);
      requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(result.start, result.end); });
    }}><Icon size={16}/></button>)}
    <button className="message-editor-preview" type="button" disabled={disabled} aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? <Pencil size={15}/> : <Eye size={15}/>} {preview ? 'Editar' : 'Vista previa'}</button>
  </div>{preview ? <div className="message-editor-render" aria-label={`Vista previa de ${label.toLowerCase()}`}>{value.trim() ? <MessageContent body={value} format="markdown"/> : <p className="muted">Tu mensaje aparecerá aquí.</p>}</div>
    : <textarea ref={area} id={id} aria-label={label} required maxLength={20000} rows={rows} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} placeholder={placeholder}/>}
    <small className="message-editor-help">Formato sencillo y enlaces seguros. El mensaje se envía cuando pulses el botón de envío.</small>
  </div>;
}
