import { useMemo, useState, useSyncExternalStore } from "react";
import { deviceStore } from "../../core/devices";
import { Select } from "../../components/Select";
import { useToast } from "../../components/Toast";
import { Button } from "../../components/Button";
import { useConfirm } from "../../components/Confirm";
import { SectionHeader } from "../../components/SectionHeader";
import { Modal } from "../../components/Modal";
import type {
  ConnectionEvent,
  DeviceRecord,
} from "../../core/db/types";
import { Platform } from "../../core/types";

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const RECENT_WINDOW = 24 * HOUR;

const SORT_OPTIONS = [
  { id: "firstSeen-desc", label: "Newest first", key: "firstSeen", dir: -1 },
  { id: "firstSeen-asc", label: "Oldest first", key: "firstSeen", dir: 1 },
  { id: "lastSeen-desc", label: "Last connected", key: "lastSeen", dir: -1 },
  { id: "name-asc", label: "Name A–Z", key: "name", dir: 1 },
  { id: "name-desc", label: "Name Z–A", key: "name", dir: -1 },
];
type SortOption = (typeof SORT_OPTIONS)[number];
type SortId = SortOption["id"];

function DeviceDetail({
  device,
  events,
  onSetRemark,
  onDelete,
  onClose,
}: {
  device: DeviceRecord;
  events: ConnectionEvent[];
  onSetRemark: (uuid: string, value: string) => void;
  onDelete: (uuid: string) => void;
  onClose: () => void;
}) {
  const [remark, setRemark] = useState(device.remark ?? "");
  const [expanded, setExpanded] = useState<number | null>(null);
  const history = useMemo(
    () =>
      events
        .filter((e) => e.uuid === device.uuid)
        .sort((a, b) => b.time - a.time)
        .slice(0, 5),
    [events, device.uuid]
  );

  const commitRemark = () => {
    const v = remark.trim();
    if (v !== (device.remark ?? "")) onSetRemark(device.uuid, v);
  };

  const name = displayNameOf(device);

  return (
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold truncate text-1">{name}</h3>
          <p className="text-xs mt-0.5 text-3">{systemOf(device)}</p>
        </div>
        <button
          onClick={onClose}
          className="text-sm px-1 interactive-text-1"
          title="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-3">First connected</dt>
          <dd className="text-1">{fmtDateTime(device.firstSeen)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-3">Last connected</dt>
          <dd className="text-1">
            {device.lastSeen ? fmtDateTime(device.lastSeen) : "—"}
          </dd>
        </div>
        {device.remark && device.name && (
          <div className="flex justify-between gap-2">
            <dt className="text-3">Hostname</dt>
            <dd className="min-w-0 truncate text-1">{device.name}</dd>
          </div>
        )}
        <div className="flex items-center gap-2">
          <dt className="text-3">Remark</dt>
          <input
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            onBlur={commitRemark}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setRemark(device.remark ?? "");
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder={device.name ?? "Unknown device"}
            className="flex-1 min-w-0 px-2 py-1 rounded text-sm outline-none input-border"
          />
        </div>
      </dl>

      <div className="mt-4">
        <SectionHeader>History (last 5)</SectionHeader>
        {history.length === 0 ? (
          <p className="text-sm text-3">No records</p>
        ) : (
          <ul className="text-sm space-y-1">
            {history.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  className="w-full text-left px-2 py-1 rounded transition-colors button-ghost"
                >
                  <span className="flex items-center gap-1 text-1">
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
                      className={e.direction === "out" ? "text-green-500" : "text-amber-500"}
                    >
                      {e.direction === "out" ? (
                        <>
                          <path d="M5 12h14" />
                          <path d="m13 6 6 6-6 6" />
                        </>
                      ) : (
                        <>
                          <path d="M19 12H5" />
                          <path d="m11 6-6 6 6 6" />
                        </>
                      )}
                    </svg>
                    {relTime(e.time)}
                  </span>
                  <span className="ml-2 text-xs text-3">
                    {e.direction === "out" ? "out" : "in"} · {e.extension}
                  </span>
                </button>
                {expanded === e.id && (
                  <div className="ml-2 px-2 pb-1 text-xs text-3">
                    Time: {fmtDateTime(e.time)} · Protocol: {e.protocol} · Extension: {e.extension}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button
        variant="danger"
        className="mt-4 w-full"
        onClick={() => onDelete(device.uuid)}
      >
        Delete device record
      </Button>
    </div>
  );
}

function Devices() {
  const { devices, events } = useSyncExternalStore(
    deviceStore.subscribe,
    deviceStore.getSnapshot
  );
  const [query, setQuery] = useState("");
  const [sortId, setSortId] = useState<SortId>("firstSeen-desc");
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const { show } = useToast();
  const confirm = useConfirm();

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return devices;
    return devices.filter((d) => {
      const name = displayNameOf(d).toLowerCase();
      const sys = systemOf(d).toLowerCase();
      return name.includes(q) || sys.includes(q);
    });
  }, [devices, q]);

  const sortOption = SORT_OPTIONS.find((o) => o.id === sortId) ?? SORT_OPTIONS[0];

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp: number;
      if (sortOption.key === "name") cmp = displayNameOf(a).localeCompare(displayNameOf(b));
      else if (sortOption.key === "lastSeen") cmp = (a.lastSeen ?? 0) - (b.lastSeen ?? 0);
      else cmp = a.firstSeen - b.firstSeen;
      return cmp * sortOption.dir;
    });
    return arr;
  }, [filtered, sortOption]);

  const recent = useMemo(
    () =>
      events
        .filter((e) => Date.now() - e.time <= RECENT_WINDOW)
        .sort((a, b) => b.time - a.time),
    [events]
  );

  const selected = devices.find((d) => d.uuid === selectedUuid) ?? null;

  const setRemark = (uuid: string, value: string) => {
    void deviceStore.setRemark(uuid, value === "" ? null : value);
    show(value === "" ? "Remark cleared" : "Remark saved");
  };

  const removeDevice = async (uuid: string) => {
    const d = devices.find((x) => x.uuid === uuid);
    const ok = await confirm({
      title: "Delete device record",
      message: `Delete ${d ? displayNameOf(d) : "this device"} and its connection history?`,
      confirmText: "Delete",
      confirmStyle: "dangerFill",
    });
    if (!ok) return;
    await deviceStore.removeDevice(uuid);
    if (selectedUuid === uuid) setSelectedUuid(null);
    show("Device record deleted");
  };

  return (
    <div
      className="device-split flex h-full"
      data-selected={selected ? true : undefined}
    >
      <div className="flex-1 min-w-0 p-4 overflow-y-auto">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
          placeholder="Search: remark / name / system"
          className="w-full px-3 py-2 rounded-md text-sm outline-none input-border"
        />

        {devices.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mt-4 space-y-4">
            {!q && (
              <section>
                <SectionHeader onClick={() => setRecentOpen((o) => !o)} open={recentOpen}>
                  Recent ({recent.length})
                </SectionHeader>
                {recentOpen && (
                  <ul className="space-y-1">
                    {recent.map((e) => {
                      const d = devices.find((x) => x.uuid === e.uuid);
                      if (!d) return null;
                      return (
                        <li
                          key={e.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors button-ghost"
                          onClick={() => setSelectedUuid(e.uuid)}
                        >
                          <span className="flex items-center text-xs text-3">
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
                              className={e.direction === "out" ? "text-green-500" : "text-amber-500"}
                            >
                              {e.direction === "out" ? (
                                <>
                                  <path d="M5 12h14" />
                                  <path d="m13 6 6 6-6 6" />
                                </>
                              ) : (
                                <>
                                  <path d="M19 12H5" />
                                  <path d="m11 6-6 6 6 6" />
                                </>
                              )}
                            </svg>
                          </span>
                          <span className="flex-1 min-w-0 truncate text-sm text-1">
                            {displayNameOf(d)}
                            <span className="ml-2 text-xs text-3">
                              {systemOf(d)} · {relTime(e.time)} · {e.extension}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}

            <section>
              <SectionHeader
                action={
                  <Select
                    value={sortId}
                    options={SORT_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
                    onChange={setSortId}
                    ariaLabel="Sort devices"
                  />
                }
              >
                Devices ({devices.length} total)
              </SectionHeader>
              {sorted.length === 0 ? (
                <p className="py-8 text-center text-sm text-3">No matching devices</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {sorted.map((d) => (
                    <div
                      key={d.uuid}
                      onClick={() => setSelectedUuid(d.uuid)}
                      className={`p-3 rounded-lg cursor-pointer transition-colors button-toggle-ghost ${selectedUuid === d.uuid
                        ? "active"
                        : ""
                        }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-1 truncate">
                          {displayNameOf(d)}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-2">{systemOf(d)}</div>
                      <div className="text-xs text-3">
                        Last: {d.lastSeen ? relTime(d.lastSeen) : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      <aside className="device-detail">
        {selected ? (
          <DeviceDetail
            key={selected.uuid}
            device={selected}
            events={events}
            onSetRemark={setRemark}
            onDelete={removeDevice}
            onClose={() => setSelectedUuid(null)}
          />
        ) : (
          <p className="m-auto text-sm text-3">Select a device</p>
        )}
      </aside>
    </div>
  );
}

//#region Utils

function displayNameOf(d: DeviceRecord): string {
  return d.remark ?? d.name ?? "Unknown device";
}

function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < MIN) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  if (diff < 2 * DAY) return "yesterday";
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} days ago`;
  return `${new Date(ts).getFullYear()}/${new Date(ts).getMonth() + 1}/${new Date(ts).getDate()}`;
}

const PLATFORM_LABEL: Record<Platform, string> = {
  windows: "Windows",
  linux: "Linux",
  android: "Android",
};

function systemOf(d: DeviceRecord): string {
  return d.os ?? (d.platform ? PLATFORM_LABEL[d.platform] : "unknown");
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="text-sm text-3">
        No connections yet
        <br />
        Devices you connect to will appear here.
      </p>
    </div>
  );
}

//#endregion

export default function DeviceManagement() {
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setDeviceModalOpen(true)}
        className="w-full flex items-center justify-between py-3 px-4 rounded-lg transition-colors text-left button-ghost"
      >
        <div>
          <div className="text-sm font-medium text-2">Device Management</div>
          <div className="text-xs text-3">Manage your connected devices and view history</div>
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-3">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>

      <Modal
        open={deviceModalOpen}
        onClose={() => setDeviceModalOpen(false)}
        title="Device Management"
        width="max-w-5xl"
        height="h-[80vh]"
      >
        <Devices />
      </Modal>
    </>
  );
}