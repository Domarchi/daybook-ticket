'use client';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { type ComboboxOption, filterOptions, firstEnabled, resultsAnnouncement, stepActive } from '@/lib/combobox';

/**
 * A select you can search: type to narrow the list (accents and case ignored, label or hint such as the email),
 * arrows to move, Enter to choose, Escape to close. ARIA 1.2 "editable combobox with list autocomplete".
 *
 * - `label` is the visible label; `ariaLabel` replaces it when the control sits in a toolbar without one.
 * - The empty choice ("Sin asignar", "Todas las empresas") is just an option whose value is ''.
 */
export function Combobox({
  label,
  ariaLabel,
  options,
  value,
  onChange,
  disabled = false,
  busy = false,
  placeholder = 'Buscar…',
  description,
  compact = false,
  name,
}: {
  label?: string;
  ariaLabel?: string;
  options: readonly ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  busy?: boolean;
  placeholder?: string;
  description?: ReactNode;
  compact?: boolean;
  name?: string;
}) {
  const id = useId(),
    listId = `${id}-list`,
    optionId = (index: number) => `${id}-option-${index}`,
    descId = `${id}-desc`;
  const selected = options.find(option => option.value === value);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null),
    rootRef = useRef<HTMLDivElement>(null),
    listRef = useRef<HTMLUListElement>(null);
  // While the list is open the box is for typing: it starts empty and the chosen label stays visible as the placeholder.
  const visible = useMemo(() => (open ? filterOptions(options, query) : []), [open, options, query]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setActive(-1);
  };
  const openList = () => {
    if (disabled || open) return;
    setOpen(true);
    setQuery('');
    const at = options.findIndex(option => option.value === value && !option.disabled);
    setActive(at >= 0 ? at : firstEnabled(options));
  };
  const choose = (option: ComboboxOption | undefined) => {
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    close();
  };

  // The list is drawn on the page, not inside the panel that holds the field (panels clip their content),
  // so it is placed by hand: below the box, or above it when there is more room there.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const list = listRef.current,
        box = inputRef.current?.getBoundingClientRect();
      if (!list || !box) return;
      const below = window.innerHeight - box.bottom - 8,
        above = box.top - 8,
        up = below < 180 && above > below;
      const width = Math.max(box.width, compact ? 240 : box.width);
      Object.assign(list.style, {
        position: 'fixed',
        width: `${width}px`,
        left: `${Math.max(8, Math.min(box.left, window.innerWidth - width - 8))}px`,
        maxHeight: `${Math.min(290, Math.max(120, up ? above : below))}px`,
        top: up ? 'auto' : `${box.bottom + 4}px`,
        bottom: up ? `${window.innerHeight - box.top + 4}px` : 'auto',
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, compact, visible.length]);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !listRef.current?.contains(target)) {
        setOpen(false);
        setQuery('');
        setActive(-1);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);
  useEffect(() => {
    if (open && active >= 0)
      (listRef.current?.children[active] as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  const move = (direction: 1 | -1) => {
    if (!open) {
      openList();
      return;
    }
    setActive(stepActive(visible, active, direction));
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        if (open) {
          event.preventDefault();
          setActive(firstEnabled(visible));
        }
        break;
      case 'End':
        if (open) {
          event.preventDefault();
          setActive(stepActive(visible, 0, -1));
        }
        break;
      case 'Enter':
        if (open) {
          event.preventDefault();
          choose(visible[active]);
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        break;
      case 'Tab':
        close();
        break;
      default:
        // Closed, the box shows the chosen name: typing (or deleting) must replace it, not append to it.
        if (
          !open &&
          (event.key === 'Backspace' ||
            event.key === 'Delete' ||
            (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey))
        )
          inputRef.current?.select();
    }
  };
  const onInput = (text: string) => {
    setOpen(true);
    setQuery(text);
    setActive(firstEnabled(filterOptions(options, text)));
  };

  return (
    <div className={`combobox-field${compact ? ' compact' : ''}`} ref={rootRef}>
      {label && <label htmlFor={id}>{label}</label>}
      <div className={`combobox${open ? ' is-open' : ''}`} aria-busy={busy || undefined}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-activedescendant={open && visible[active] ? optionId(active) : undefined}
          aria-label={label ? undefined : ariaLabel}
          aria-describedby={description ? descId : undefined}
          placeholder={open ? (selected?.label ?? placeholder) : undefined}
          disabled={disabled}
          value={open ? query : (selected?.label ?? '')}
          onClick={() => openList()}
          onChange={event => {
            const raw = event.target.value;
            onInput(
              !open && selected?.label && raw.startsWith(selected.label) ? raw.slice(selected.label.length) : raw,
            );
          }}
          onKeyDown={onKeyDown}
          onBlur={event => {
            if (!rootRef.current?.contains(event.relatedTarget as Node | null)) close();
          }}
        />
        <button
          type="button"
          className="combobox-toggle"
          tabIndex={-1}
          aria-label={open ? 'Cerrar lista' : 'Abrir lista'}
          disabled={disabled}
          onMouseDown={event => event.preventDefault()}
          onClick={() => {
            if (open) close();
            else {
              inputRef.current?.focus();
              openList();
            }
          }}
        >
          <span aria-hidden="true">▾</span>
        </button>
        {open &&
          createPortal(
            <ul className="combobox-list" id={listId} role="listbox" aria-label={label ?? ariaLabel} ref={listRef}>
              {visible.length === 0 && (
                <li className="combobox-empty" role="presentation">
                  Sin resultados
                </li>
              )}
              {visible.map((option, index) => {
                return (
                  <li
                    key={option.value || '__empty'}
                    id={optionId(index)}
                    role="option"
                    aria-selected={option.value === value}
                    aria-disabled={option.disabled || undefined}
                    className={`combobox-option${index === active ? ' is-active' : ''}${option.value === value ? ' is-selected' : ''}`}
                    onMouseDown={event => event.preventDefault()}
                    onMouseMove={() => {
                      if (!option.disabled && index !== active) setActive(index);
                    }}
                    onClick={() => choose(option)}
                  >
                    <span>{option.label}</span>
                    {option.hint && <small>{option.hint}</small>}
                  </li>
                );
              })}
            </ul>,
            document.body,
          )}
      </div>
      {name !== undefined && <input type="hidden" name={name} value={value} />}
      {description && (
        <small id={descId} className="combobox-description">
          {description}
        </small>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {open && query ? resultsAnnouncement(visible.length) : ''}
      </span>
    </div>
  );
}
