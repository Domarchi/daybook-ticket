'use client';
import { Fragment, useId, useLayoutEffect, useRef, useState } from 'react';
import { Bold, Italic, Link, List, ListOrdered, Code, Eye, Pencil, Type } from 'lucide-react';
import { formatSelection, messageBlocks, messageInlineParts, type MessageFormat } from '@/lib/message-format';

function Inline({ text }: { text: string }) {
  return messageInlineParts(text).map((part, index) =>
    part.type === 'bold' ? (
      <strong key={index}>{part.text}</strong>
    ) : part.type === 'italic' ? (
      <em key={index}>{part.text}</em>
    ) : part.type === 'code' ? (
      <code key={index}>{part.text}</code>
    ) : part.type === 'link' ? (
      <a key={index} href={part.href} target="_blank" rel="noopener noreferrer nofollow">
        {part.text}
      </a>
    ) : (
      <Fragment key={index}>{part.text}</Fragment>
    ),
  );
}
export function MessageContent({ body, format = 'plain' }: { body: string; format?: MessageFormat }) {
  if (format !== 'markdown') return <p className="message-content-plain">{body}</p>;
  return (
    <div className="message-content-rich">
      {messageBlocks(body).map((block, index) =>
        block.type === 'paragraph' ? (
          <p key={index}>
            <Inline text={block.lines.join('\n')} />
          </p>
        ) : block.type === 'unordered' ? (
          <ul key={index}>
            {block.lines.map((line, i) => (
              <li key={i}>
                <Inline text={line} />
              </li>
            ))}
          </ul>
        ) : (
          <ol key={index}>
            {block.lines.map((line, i) => (
              <li key={i}>
                <Inline text={line} />
              </li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

export function MessageEditor({
  value,
  onChange,
  label,
  disabled = false,
  placeholder,
  rows = 6,
  id,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
  id?: string;
  compact?: boolean;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const shortcutFocus = useRef<{ body: string; waiting: boolean } | null>(null);
  const [preview, setPreview] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const editorId = useId();
  const inputId = id || `${editorId}-input`;
  const formatId = `${editorId}-format`;
  const helpId = `${editorId}-help`;

  useLayoutEffect(() => {
    const input = area.current;
    if (!input) return;
    if (!compact) {
      input.style.removeProperty('height');
      input.style.removeProperty('overflow-y');
      return;
    }
    const resize = () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
      input.style.overflowY = input.scrollHeight > 180 ? 'auto' : 'hidden';
    };
    resize();
    // Reflow wrapped drafts after a viewport or layout-width change as well.
    let width = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (input.clientWidth === width) return;
      width = input.clientWidth;
      resize();
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [compact, value, preview]);

  useLayoutEffect(() => {
    const intent = shortcutFocus.current;
    if (!intent) return;
    if (!compact || preview) {
      shortcutFocus.current = null;
      return;
    }
    if (disabled) {
      intent.waiting = true;
      return;
    }
    if (!intent.waiting && value !== '') {
      if (value !== intent.body) shortcutFocus.current = null;
      return;
    }
    shortcutFocus.current = null;
    const input = area.current;
    if (!input?.isConnected || input.disabled) return;
    const doc = input.ownerDocument;
    if (doc.hasFocus() && (doc.activeElement === doc.body || doc.activeElement === input)) {
      input.focus({ preventScroll: true });
    }
  }, [compact, disabled, preview, value]);

  const actions = [
    { action: 'bold', label: 'Negrita', icon: Bold },
    { action: 'italic', label: 'Cursiva', icon: Italic },
    { action: 'list', label: 'Lista con viñetas', icon: List },
    { action: 'ordered', label: 'Lista numerada', icon: ListOrdered },
    { action: 'link', label: 'Insertar enlace', icon: Link },
    { action: 'code', label: 'Código', icon: Code },
  ] as const;
  return (
    <div className={`message-editor${compact ? ' is-compact' : ''}`}>
      {compact && (
        <label className="sr-only" htmlFor={inputId}>
          {label}
        </label>
      )}
      <div className="message-editor-toolbar" role="toolbar" aria-label={`Formato de ${label.toLowerCase()}`}>
        {compact && (
          <button
            className="message-editor-format-toggle"
            type="button"
            disabled={disabled}
            aria-expanded={formatting}
            aria-controls={formatId}
            onClick={() => setFormatting(!formatting)}
          >
            <Type size={16} />
            Formato
          </button>
        )}
        <div id={formatId} className="message-editor-format-actions" hidden={compact && !formatting}>
          {actions.map(({ action, label: title, icon: Icon }) => (
            <button
              key={action}
              type="button"
              title={title}
              aria-label={title}
              disabled={disabled || preview}
              onMouseDown={event => event.preventDefault()}
              onClick={() => {
                const input = area.current;
                const result = formatSelection(
                  value,
                  input?.selectionStart ?? value.length,
                  input?.selectionEnd ?? value.length,
                  action,
                );
                if (result.body.length > 20000) return;
                onChange(result.body);
                requestAnimationFrame(() => {
                  if (!input?.isConnected || input.disabled) return;
                  input.focus();
                  input.setSelectionRange(result.start, result.end);
                });
              }}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
        <button
          className="message-editor-preview"
          type="button"
          disabled={disabled}
          aria-pressed={preview}
          onClick={() => setPreview(!preview)}
        >
          {preview ? <Pencil size={15} /> : <Eye size={15} />} {preview ? 'Editar' : 'Vista previa'}
        </button>
      </div>
      {preview ? (
        <div className="message-editor-render" aria-label={`Vista previa de ${label.toLowerCase()}`}>
          {value.trim() ? (
            <MessageContent body={value} format="markdown" />
          ) : (
            <p className="muted">Tu mensaje aparecerá aquí.</p>
          )}
        </div>
      ) : (
        <textarea
          ref={area}
          id={inputId}
          aria-label={label}
          aria-describedby={helpId}
          aria-keyshortcuts={compact ? 'Control+Enter Meta+Enter' : undefined}
          required
          maxLength={20000}
          rows={compact ? 1 : rows}
          value={value}
          disabled={disabled}
          onChange={event => onChange(event.target.value)}
          placeholder={placeholder}
          onKeyDown={event => {
            if (
              !compact ||
              disabled ||
              event.key !== 'Enter' ||
              !(event.ctrlKey || event.metaKey) ||
              event.altKey ||
              event.shiftKey ||
              event.repeat ||
              event.nativeEvent.isComposing
            )
              return;
            event.preventDefault();
            const input = event.currentTarget;
            if (!input.form) return;
            const intent = { body: value, waiting: false };
            shortcutFocus.current = intent;
            input.form.requestSubmit();
            requestAnimationFrame(() => {
              // Invalid or blocked submissions must not retain a future focus request.
              if (shortcutFocus.current === intent && !intent.waiting && !input.disabled) shortcutFocus.current = null;
            });
          }}
        />
      )}
      <small className="message-editor-help" id={helpId}>
        {compact
          ? 'Enter para una nueva línea · Ctrl/⌘ + Enter para enviar.'
          : 'Formato sencillo y enlaces seguros. El mensaje se envía cuando pulses el botón de envío.'}
      </small>
    </div>
  );
}
