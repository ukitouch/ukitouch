import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

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
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  className = "",
  ariaLabel,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
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

  // Close on outside pointer-down.
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

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
        className="flex min-w-40 items-center justify-between gap-1 whitespace-nowrap p-2 rounded-md bg-gray-100 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 outline-none focus:ring-1 focus:ring-gray-400 select-none"
      >
        <span>{current?.label ?? ""}</span>
        <span
          aria-hidden
          className={`inline-flex transition-transform ${open ? "rotate-180" : ""}`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute top-full left-0 z-50 mt-1 w-full py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 shadow-lg border border-gray-300 dark:border-gray-700"
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
                className={`block w-full text-left px-3 py-1.5 transition-colors ${i === highlight
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
  );
}
