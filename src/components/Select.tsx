import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

/** Nearest ancestor that scrolls (the boundary a dropdown must not cross). */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|hidden)/.test(style.overflowX + style.overflowY)) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  ariaLabel?: string;
  /**
   * Optional manual anchor override. Omit for the default automatic behaviour
   * (right-first: opens rightward when there is room, flips leftward when the
   * right edge is too close). "start" = always open rightward; "end" = always
   * open leftward.
   */
  align?: "start" | "end";
}

/**
 * Dropdown select rendered with divs instead of the native <select>, so look
 * and behaviour are consistent across webviews: native selects open platform
 * popups on mobile and ignore CSS styling on some Linux webviews.
 *
 * The list is right-first: it opens rightward (left-anchored) when there is
 * room inside the scroll container, and flips leftward automatically when the
 * right edge is too close — so it never overflows or hides behind neighbours.
 * Pass `align` to force a direction instead.
 *
 * On narrow screens the option list renders as a bottom sheet (full-width,
 * fixed at the bottom edge) instead of an anchored popover.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  className = "",
  ariaLabel,
  align,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // true = anchored to the trigger's right edge (list expands leftward)
  const [anchorEnd, setAnchorEnd] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const current = options.find((o) => o.value === value) ?? options[0];

  // Reset highlight to the selected option whenever the list opens.
  useEffect(() => {
    if (open) {
      setHighlight(Math.max(0, options.findIndex((o) => o.value === value)));
    }
  }, [open, value, options]);

  // Keep the highlighted option in view while navigating with the keyboard.
  useEffect(() => {
    if (!open) return;
    listRef.current?.children[highlight]?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  // Right-first anchoring: measured before paint (useLayoutEffect) so the list
  // never visibly jumps. The list is already mounted here, so its real width is
  // available; flipping left/right does not change that width. Skipped when an
  // explicit `align` override is given.
  useLayoutEffect(() => {
    if (!open || align !== undefined) return;
    const update = () => {
      const root = rootRef.current;
      const list = listRef.current;
      if (!root || !list) return;
      const trigger = root.getBoundingClientRect();
      const listWidth = list.getBoundingClientRect().width;
      const container = findScrollParent(root) ?? document.documentElement;
      const rightSpace = container.getBoundingClientRect().right - trigger.right;
      setAnchorEnd(rightSpace < listWidth + 8); // 8px breathing room
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open, align]);

  // Close on outside pointer-down. The mobile backdrop is rendered outside
  // rootRef on purpose, so tapping it closes the list as well.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: globalThis.PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (options.length === 0) return;
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
        setHighlight((h) => (h + 1) % options.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlight((h) => (h - 1 + options.length) % options.length);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        const opt = options[highlight];
        if (opt) {
          onChange(opt.value);
          setOpen(false);
        }
        break;
    }
  };

  // Explicit `align` wins; otherwise use the auto right-first measurement.
  const effectiveEnd = align === "end" || (align === undefined && anchorEnd);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 hidden max-md:block"
          onPointerDown={() => setOpen(false)}
        />
      )}
      <div ref={rootRef} className={`relative inline-block ${className}`}>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={handleKeyDown}
          className="flex items-center gap-1 whitespace-nowrap px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 outline-none focus:ring-1 focus:ring-gray-400 select-none"
        >
          <span>{current?.label ?? ""}</span>
          <span aria-hidden className="text-xs">
            {open ? "▴" : "▾"}
          </span>
        </button>
        {open && (
          <ul
            ref={listRef}
            role="listbox"
            className={`absolute top-full z-50 mt-1 min-w-40 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 shadow-lg border border-gray-300 dark:border-gray-700 ${
              effectiveEnd ? "right-0" : "left-0"
            } max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:mt-0 max-md:rounded-t-xl max-md:rounded-b-none max-md:border-b-0 max-md:py-2 max-md:shadow-2xl`}
          >
            {options.map((o, i) => (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  onPointerEnter={() => setHighlight(i)}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`block w-full text-left px-3 py-1.5 transition-colors ${
                    i === highlight
                      ? "bg-gray-200 dark:bg-gray-700"
                      : "hover:bg-gray-200 dark:hover:bg-gray-700"
                  } ${o.value === value ? "font-medium" : ""}`}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
