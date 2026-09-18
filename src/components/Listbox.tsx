import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";

/** A row rendered by {@link ListboxPanel}. */
export interface ListboxEntry {
  id: string;
  label: string;
  /** Secondary text after the label. */
  hint?: string;
  /** Monospace suffix (the "create new" row). */
  code?: string;
}

export interface ListboxArgs {
  entries: readonly ListboxEntry[];
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Receives the index of the picked row. */
  onPick: (index: number) => void;
  /** Highlight restored whenever the list opens. Defaults to 0. */
  initialHighlight?: number;
}

/**
 * Open/close, highlight, keyboard navigation and outside-click dismissal for a
 * listbox popup. Triggers own the `open` state; {@link ListboxPanel} renders it.
 */
export function useListbox({
  entries,
  open,
  setOpen,
  onPick,
  initialHighlight = 0,
}: ListboxArgs) {
  const [rawHighlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const initial = useRef(initialHighlight);
  initial.current = initialHighlight;

  const count = entries.length;
  // Clamp so a shrinking (filtered) list never points past the end.
  const highlight = count === 0 ? 0 : Math.min(rawHighlight, count - 1);

  // Restore the initial highlight whenever the list opens.
  useEffect(() => {
    if (open) setHighlight(initial.current);
  }, [open]);

  // Keep the highlighted row in view.
  useEffect(() => {
    if (!open) return;
    listRef.current?.children[highlight]?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  // Close on outside pointer-down.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, setOpen]);

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (count === 0) return;
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case "Escape":
        setOpen(false);
        break;
      case "ArrowDown":
        e.preventDefault();
        setHighlight((h) => (h + 1) % count);
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlight((h) => (h - 1 + count) % count);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        onPick(highlight);
        break;
    }
  };

  return { highlight, setHighlight, rootRef, listRef, handleKeyDown };
}

export interface ListboxPanelProps {
  open: boolean;
  entries: readonly ListboxEntry[];
  highlight: number;
  onHighlight: (index: number) => void;
  onPick: (index: number) => void;
  /** Id of the selected entry, for `aria-selected`. */
  selectedId?: string | null;
  /** Shown when `entries` is empty. */
  emptyText: string;
  listRef: RefObject<HTMLUListElement | null>;
  className?: string;
}

/** The popup list shared by every listbox-style picker. */
export function ListboxPanel({
  open,
  entries,
  highlight,
  onHighlight,
  onPick,
  selectedId = null,
  emptyText,
  listRef,
  className = "",
}: ListboxPanelProps) {
  if (!open) return null;
  return (
    <div
      className={`absolute top-full left-0 z-50 mt-1 w-full max-h-48 overflow-y-auto py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 shadow-lg border border-gray-300 dark:border-gray-700 ${className}`}
    >
      {entries.length === 0 ? (
        <div className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400">
          {emptyText}
        </div>
      ) : (
        <ul ref={listRef} role="listbox">
          {entries.map((o, i) => (
            <li key={o.id}>
              <button
                type="button"
                role="option"
                aria-selected={o.id === selectedId}
                onPointerEnter={() => onHighlight(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(i)}
                className={`block w-full text-left px-3 py-1.5 transition-colors ${i === highlight
                    ? "bg-gray-200 dark:bg-gray-700"
                    : "hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
              >
                <span className="truncate">{o.label}</span>
                {o.hint && (
                  <span className="ml-1 text-xs text-gray-500">{o.hint}</span>
                )}
                {o.code && (
                  <code className="ml-1 font-mono text-xs">{o.code}</code>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
