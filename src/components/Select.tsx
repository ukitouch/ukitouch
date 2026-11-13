import { useState } from "react";
import { ListboxPanel, useListbox, type ListboxEntry } from "./Listbox";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string> {
  /** The currently selected value. */
  value: T;
  /** The options to choose from. */
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  ariaLabel?: string;
}

/**
 * A select component.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  className = "",
  ariaLabel,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);

  const entries: ListboxEntry[] = options.map((o) => ({
    id: o.value,
    label: o.label,
  }));
  const selectedIndex = entries.findIndex((e) => e.id === value);
  const current = options.find((o) => o.value === value) ?? options[0];

  const pick = (i: number) => {
    const opt = options[i];
    if (opt) {
      onChange(opt.value);
      setOpen(false);
    }
  };

  const { highlight, setHighlight, rootRef, listRef, handleKeyDown } = useListbox({
    entries,
    open,
    setOpen,
    initialHighlight: Math.max(0, selectedIndex),
    onPick: pick,
  });

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
        className={`flex min-w-40 items-center justify-between gap-1 whitespace-nowrap p-2 rounded-md text-sm select-none button-primary text-2`}
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
      <ListboxPanel
        open={open}
        entries={entries}
        highlight={highlight}
        onHighlight={setHighlight}
        onPick={pick}
        selectedId={value}
        emptyText="No options"
        listRef={listRef}
      />
    </div>
  );
}
