import { useState } from "react";
import type { DeviceRecord } from "../core/db";
import { ListboxEntry, useListbox, ListboxPanel } from "./Listbox";

export interface PeerDeviceSearchProps {
  /** Known peers to search over. */
  devices: readonly DeviceRecord[];
  /** Currently picked peer uuid, or null for a temp id input. */
  selectedUuid: string | null;
  /** Input text, or shows as a chip while a peer is picked. */
  text: string;
  /** Calls when input text changed. */
  onTextChange: (text: string) => void;
  /** Calls when selected a known peer. */
  onSelect: (uuid: string, label: string) => void;
  /** Calls when selected input text that does not match any known peer. */
  onCreate?: (query: string) => void;
  className?: string;
  placeholder?: string;
}

/** Entry id reserved for the "create new" row. */
const CREATE_ID = "\u0000create";

/**
 * p2p peer picker: searches known devices, optionally dials a temp id.
 */
export function PeerDeviceSearch({
  devices,
  selectedUuid,
  text,
  onTextChange,
  onSelect,
  onCreate,
  className = "relative flex-1 min-w-40",
}: PeerDeviceSearchProps) {
  const placeholder = "Select a device or enter a temp id",
    emptyText = "No known devices yet.",
    createLabel = "Connect to new device";

  const [open, setOpen] = useState(false);
  const options = [...devices]
    .sort(
      (a, b) =>
        (b.connectCount ?? 0) - (a.connectCount ?? 0) ||
        (b.lastSeen ?? 0) - (a.lastSeen ?? 0),
    )
    .map((d) => ({
      id: d.uuid,
      label: d.remark ?? d.name ?? "Unknown device",
      hint: d.platform ?? undefined,
    }));

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
    else onSelect(entry.id, entry.label);
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
          className="w-full rounded-md px-3 py-1.5 text-sm input-border"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            if (selectedUuid !== null) onTextChange("");
            setOpen(true);
          }}
          className="w-full flex items-center text-left truncate rounded-md px-3 py-1.5 text-sm input-border text-2"
        >
          {selectedUuid !== null ? (
            <span className="max-w-full truncate rounded px-1.5 bg-tag">
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
        selectedId={selectedUuid}
        emptyText={emptyText}
        listRef={listRef}
      />
    </div>
  );
}
