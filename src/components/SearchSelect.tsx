import { useState } from "react";
import { ListboxPanel, useListbox, type ListboxEntry } from "./Listbox";

/** Entry id reserved for the "create new" row. */
const CREATE_ID = "\u0000create";

export interface SearchOption {
  /** Stable id handed back to `onSelect`. */
  id: string;
  /** Primary text. */
  label: string;
  /** Secondary text shown after the label (e.g. platform). */
  hint?: string;
}

export interface SearchSelectProps {
  /** Input text (controlled). Doubles as the free-text value. */
  text: string;
  /** Id of the picked option, or null for a free-text value. */
  selectedId: string | null;
  options: readonly SearchOption[];
  /** The user typed; the caller decides whether to drop the selection. */
  onTextChange: (text: string) => void;
  onSelect: (option: SearchOption) => void;
  /**
   * Enables the "create new" row and receives the trimmed text.
   * Omit to hide it.
   */
  onCreate?: (query: string) => void;
  placeholder?: string;
  /** Shown when nothing matches and `onCreate` is absent. */
  emptyText?: string;
  /** Label for the create row. Defaults to "Connect to new device". */
  createLabel?: string;
  className?: string;
}

/**
 * Searchable single-select with an optional free-text "create new" row.
 *
 * Filtering is case-insensitive substring match over `label`.
 */
export function SearchSelect({
  text,
  selectedId,
  options,
  onTextChange,
  onSelect,
  onCreate,
  placeholder = "Select a device or enter a temp id",
  emptyText = "No known devices yet.",
  createLabel = "Connect to new device",
  className = "relative flex-1 min-w-40",
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);

  const q = text.trim().toLowerCase();
  const filtered =
    q === "" ? options : options.filter((o) => o.label.toLowerCase().includes(q));
  const showCreate = onCreate !== undefined && q !== "" && filtered.length === 0;

  const entries: ListboxEntry[] = filtered.map((o) => ({
    id: o.id,
    label: o.label,
    hint: o.hint,
  }));
  if (showCreate) {
    entries.push({ id: CREATE_ID, label: createLabel, code: text.trim() });
  }

  const pick = (i: number) => {
    const entry = entries[i];
    if (!entry) return;
    if (entry.id === CREATE_ID) onCreate?.(text.trim());
    else onSelect({ id: entry.id, label: entry.label, hint: entry.hint });
    setOpen(false);
  };

  const { highlight, setHighlight, rootRef, listRef, handleKeyDown } = useListbox({
    entries,
    open,
    setOpen,
    onPick: pick,
  });

  return (
    <div ref={rootRef} className={className}>
      {open ? (
        <input
          autoFocus
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => setOpen(false)}
          placeholder={placeholder}
          className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md px-3 py-1.5 text-sm"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            if (selectedId !== null) onTextChange("");
            setOpen(true);
          }}
          className="w-full flex items-center text-left truncate rounded-md bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300"
        >
          {selectedId !== null ? (
            <span className="max-w-full truncate rounded bg-gray-200 dark:bg-gray-700 px-1.5">
              {text.trim()}
            </span>
          ) : (
            text.trim() || placeholder
          )}
        </button>
      )}
      <ListboxPanel
        open={open}
        entries={entries}
        highlight={highlight}
        onHighlight={setHighlight}
        onPick={pick}
        selectedId={selectedId}
        emptyText={emptyText}
        listRef={listRef}
      />
    </div>
  );
}
