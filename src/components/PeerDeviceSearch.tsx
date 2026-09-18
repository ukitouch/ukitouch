import type { DeviceRecord } from "../core/db";
import { SearchSelect } from "./SearchSelect";

export interface PeerDeviceSearchProps {
  /** Known peers to search over. */
  devices: readonly DeviceRecord[];
  /** Currently picked peer uuid, or null for a free-text temp id. */
  selectedUuid: string | null;
  /** Input text (controlled); shows as a chip while a peer is picked. */
  text: string;
  onTextChange: (text: string) => void;
  /** A known peer was picked. */
  onSelect: (uuid: string, label: string) => void;
  /** Free-text dial; receives the trimmed temp id. Omit to hide the row. */
  onCreate?: (query: string) => void;
  className?: string;
  placeholder?: string;
}

/**
 * p2p peer picker: searches known devices, optionally dials a temp id.
 *
 * Label priority is `remark > name > "Unknown device"`; platform is the hint.
 */
export function PeerDeviceSearch({
  devices,
  selectedUuid,
  text,
  onTextChange,
  onSelect,
  onCreate,
  className,
  placeholder,
}: PeerDeviceSearchProps) {
  return (
    <SearchSelect
      text={text}
      selectedId={selectedUuid}
      options={devices.map((d) => ({
        id: d.uuid,
        label: d.remark ?? d.name ?? "Unknown device",
        hint: d.platform ?? undefined,
      }))}
      onTextChange={onTextChange}
      onSelect={(o) => onSelect(o.id, o.label)}
      onCreate={onCreate}
      className={className}
      placeholder={placeholder}
    />
  );
}
