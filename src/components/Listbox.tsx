import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, KeyboardEvent, RefObject } from "react";

/** A row rendered by {@link ListboxPanel}. */
export interface ListboxEntry {
  id: string;
  label: string;
  /** Secondary text after the label. */
  hint?: string;
  /** Monospace suffix. */
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
  const panelRef = useRef<HTMLDivElement | null>(null);
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

  // Close on 'blur'
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };

    const onMove = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
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

  return { highlight, setHighlight, rootRef, listRef, panelRef, handleKeyDown };
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
  /** The element the panel is anchored to. */
  anchor: RefObject<HTMLDivElement | null>;
  listRef: RefObject<HTMLUListElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
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
  anchor,
  listRef,
  panelRef,
  className = "",
}: ListboxPanelProps) {
  const GAP = 4;
  const PAD = 8;

  // Hidden off-screen until its real height is measured.
  const [pos, setPos] = useState<CSSProperties>({
    position: "fixed",
    top: -9999,
    left: -9999,
  });

  useLayoutEffect(() => {
    if (!open) return;
    const el = panelRef.current;
    const a = anchor.current?.getBoundingClientRect();
    if (!el || !a) return;
    const h = el.offsetHeight;
    const below = a.bottom + GAP + h <= window.innerHeight - PAD;
    setPos({
      position: "fixed",
      top: below ? a.bottom + GAP : Math.max(PAD, a.top - GAP - h),
    });
  }, [open, entries.length, anchor, panelRef]);

  if (!open) return null;
  const a = anchor.current?.getBoundingClientRect();
  const w = a
    ? Math.min(Math.max(a.width, 100), window.innerWidth - PAD * 2)
    : undefined;
  const style: CSSProperties = a
    ? {
      ...pos,
      width: w,
      left: Math.max(PAD, Math.min(a.left, window.innerWidth - (w ?? 0) - PAD)),
    }
    : pos;
  return createPortal(
    <div
      ref={panelRef}
      style={style}
      className={`z-50 max-h-48 overflow-y-auto py-1 rounded-md bg-window text-sm shadow-lg ${className}`}
    >
      {entries.length === 0 ? (
        <div className="px-3 py-1.5 text-sm text-3">
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
                className={`block w-full text-left px-3 py-1.5 interactive-row ${i === highlight
                  ? "active"
                  : ""
                  }`}
              >
                <span className="truncate">{o.label}</span>
                {o.hint && (
                  <span className="ml-1 text-xs text-3">{o.hint}</span>
                )}
                {o.code && (
                  <code className="ml-1 font-mono text-xs text-3">{o.code}</code>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.body
  );
}
