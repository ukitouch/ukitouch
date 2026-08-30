// Device Management panel (Settings page)
// Data is persisted in IndexedDB via the DeviceStore (src/core/devices.ts).
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { deviceStore } from "./core/devices";
import type {
  ConnectionEvent,
  DeviceRecord,
  Platform,
} from "./core/db/types";

//#region Time helpers (relative timestamps)

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
//#endregion

//#region Helpers

/** Display name: remark > hostname > "Unknown device". */
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
  macos: "macOS",
  linux: "Linux",
  android: "Android",
  ios: "iOS",
};

function systemOf(d: DeviceRecord): string {
  return d.os ?? (d.platform ? PLATFORM_LABEL[d.platform] : "unknown");
}
//#endregion

//#region Small components

function OnlineDot({ online }: { online: boolean | null }) {
  if (online === null) {
    return (
      <span className="text-gray-500 dark:text-gray-500" title="Unknown (signaling unreachable)">
        ?
      </span>
    );
  }
  return (
    <span
      className={online ? "text-green-500" : "text-gray-400"}
      title={online ? "Online" : "Offline"}
    >
      {online ? "●" : "○"}
    </span>
  );
}

// Empty state
function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="text-4xl">🖥️</div>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        No connections yet
        <br />
        Devices you connect to will appear here. Rename them to tell them apart.
      </p>
    </div>
  );
}

// Module-level toast bridge (mock; replace with the real notification layer later)
let notify: (msg: string) => void = () => {};
//#endregion

//#region Device details

function DeviceDetail({
  device,
  events,
  focusRemark,
  onSetRemark,
  onDelete,
  onClose,
}: {
  device: DeviceRecord;
  events: ConnectionEvent[];
  focusRemark: boolean;
  onSetRemark: (uuid: string, value: string) => void;
  onDelete: (uuid: string) => void;
  onClose: () => void;
}) {
  const [remark, setRemark] = useState(device.remark ?? device.name ?? "");
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
    onSetRemark(device.uuid, v === "" ? "" : v); // empty = clear remark, fall back to hostname/Unknown device
  };

  const name = displayNameOf(device);

  return (
    <aside className="w-80 shrink-0 border-l-2 border-gray-800 dark:border-gray-600 p-4 overflow-y-auto max-md:w-full max-md:border-l-0 max-md:border-t-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">{name}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            <OnlineDot online={device.online} /> {systemOf(device)}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-sm px-1"
          title="Close"
        >
          ✕
        </button>
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-gray-500 dark:text-gray-400">First connected</dt>
          <dd className="text-gray-900 dark:text-gray-100">{fmtDateTime(device.firstSeen)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500 dark:text-gray-400">Last connected</dt>
          <dd className="text-gray-900 dark:text-gray-100">
            {device.lastSeen ? fmtDateTime(device.lastSeen) : "—"}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-gray-500 dark:text-gray-400">Remark</dt>
          <input
            value={remark}
            autoFocus={focusRemark}
            onChange={(e) => setRemark(e.target.value)}
            onBlur={commitRemark}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRemark();
              if (e.key === "Escape") {
                setRemark(device.remark ?? device.name ?? "");
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder={device.name ?? "Unknown device"}
            className="flex-1 min-w-0 px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm outline-none focus:ring-1 focus:ring-gray-400"
          />
        </div>
      </dl>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
          History (last 5)
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No records</p>
        ) : (
          <ul className="text-sm space-y-1">
            {history.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  className="w-full text-left px-2 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  <span className="text-gray-900 dark:text-gray-100">
                    {e.direction === "out" ? "▶" : "◀"} {relTime(e.time)}
                  </span>
                  <span className="ml-2 text-gray-500 dark:text-gray-400 text-xs">
                    {e.direction === "out" ? "out" : "in"} · {e.plugin ?? "core"}
                  </span>
                </button>
                {expanded === e.id && (
                  <div className="ml-2 px-2 pb-1 text-xs text-gray-500 dark:text-gray-400">
                    Time: {fmtDateTime(e.time)} · Protocol: {e.protocol} · Plugin: {e.plugin ?? "core (handshake)"}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
          Plugin info (read-only · reportMeta)
        </div>
        {Object.keys(device.meta).length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">None</p>
        ) : (
          <ul className="text-xs space-y-1 text-gray-700 dark:text-gray-300">
            {Object.entries(device.meta).map(([ns, data]) => (
              <li key={ns}>
                <code>
                  {ns}: {JSON.stringify(data)}
                </code>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        onClick={() => onDelete(device.uuid)}
        className="mt-4 w-full px-3 py-1.5 rounded-md text-sm text-red-500 hover:bg-red-500/10 border border-red-500/40 transition-colors"
      >
        Delete device record
      </button>
    </aside>
  );
}
//#endregion

//#region Device Management main view

/** Sort modes for the device list; single source of truth for labels, values and ordering. */
const SORT_OPTIONS = [
  { id: "firstSeen-desc", label: "Newest first", key: "firstSeen", dir: -1 },
  { id: "firstSeen-asc", label: "Oldest first", key: "firstSeen", dir: 1 },
  { id: "lastSeen-desc", label: "Last connected", key: "lastSeen", dir: -1 },
  { id: "name-asc", label: "Name A–Z", key: "name", dir: 1 },
  { id: "name-desc", label: "Name Z–A", key: "name", dir: -1 },
] as const;

type SortOption = (typeof SORT_OPTIONS)[number];
type SortId = SortOption["id"];

function Devices() {
  const { devices, events } = useSyncExternalStore(
    deviceStore.subscribe,
    deviceStore.getSnapshot
  );
  const [query, setQuery] = useState("");
  const [sortId, setSortId] = useState<SortId>("firstSeen-desc"); // default: newest registration first
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [focusRemark, setFocusRemark] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false); // Recent collapsed by default
  const [menu, setMenu] = useState<{ x: number; y: number; uuid: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  notify = (msg: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  };

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return devices;
    return devices.filter((d) => {
      const name = displayNameOf(d).toLowerCase();
      const sys = systemOf(d).toLowerCase();
      return name.includes(q) || sys.includes(q);
    });
  }, [devices, q]);

  const sortOption =
    SORT_OPTIONS.find((o) => o.id === sortId) ?? SORT_OPTIONS[0];

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
    () => [...events].sort((a, b) => b.time - a.time).slice(0, 5),
    [events]
  );

  const selected = devices.find((d) => d.uuid === selectedUuid) ?? null;

  const openDetail = (uuid: string, focus = false) => {
    setSelectedUuid(uuid);
    setFocusRemark(focus);
  };

  const setRemark = (uuid: string, value: string) => {
    void deviceStore.setRemark(uuid, value === "" ? null : value); // empty = clear remark, fall back to hostname/Unknown device
    notify("Remark saved");
  };

  const connectTo = (uuid: string, actionId?: string) => {
    const d = devices.find((x) => x.uuid === uuid);
    if (!d) return;
    const last = events
      .filter((e) => e.uuid === uuid)
      .sort((a, b) => b.time - a.time)[0];
    const plugin = actionId ?? last?.plugin ?? null;
    notify(`Connecting to "${displayNameOf(d)}" via ${plugin ?? "core"}… (mock)`);
  };

  const removeDevice = (uuid: string) => {
    const d = devices.find((x) => x.uuid === uuid);
    if (!d) return;
    if (
      !window.confirm(
        `Delete the record for "${displayNameOf(d)}"?\nThis only removes the local record; the device identity is unaffected.`
      )
    )
      return;
    void deviceStore.removeDevice(uuid);
    if (selectedUuid === uuid) setSelectedUuid(null);
    setMenu(null);
    notify("Device record deleted");
  };

  interface MenuAction {
    label: string;
    danger?: boolean;
    fn: () => void;
  }

  const menuActions: MenuAction[] | null = menu
    ? [
        { label: "Connect (last plugin)", fn: () => connectTo(menu.uuid) },
        { label: "Rename", fn: () => openDetail(menu.uuid, true) },
        { label: "Delete record", danger: true, fn: () => removeDevice(menu.uuid) },
      ]
    : null;

  return (
    <div className="space-y-4">
      {/* Search */}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQuery("");
        }}
        placeholder="🔍 Search: remark / name / system"
        className="w-full px-3 py-2 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm outline-none focus:ring-1 focus:ring-gray-400"
      />

      {devices.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex gap-4 items-start max-md:flex-col">
          <div className="flex-1 min-w-0 space-y-4 max-md:w-full">
            {/* Recent (≤5 items, collapsed by default) */}
            {!q && (
              <section>
                <button
                  onClick={() => setRecentOpen((o) => !o)}
                  className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 hover:text-gray-800 dark:hover:text-gray-200 select-none"
                >
                  <span>{recentOpen ? "▾" : "▸"}</span>
                  Recent ({recent.length})
                </button>
                {recentOpen && (
                <ul className="space-y-1">
                  {recent.map((e) => {
                    const d = devices.find((x) => x.uuid === e.uuid);
                    if (!d) return null;
                    return (
                      <li
                        key={e.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                        onClick={() =>
                          e.direction === "out" ? connectTo(e.uuid) : openDetail(e.uuid)
                        }
                      >
                        <span className="text-gray-500 dark:text-gray-400 text-xs">
                          {e.direction === "out" ? "▶" : "◀"}
                        </span>
                        <span className="flex-1 min-w-0 truncate text-sm text-gray-900 dark:text-gray-100">
                          {displayNameOf(d)}
                          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                            {systemOf(d)} · {relTime(e.time)} · {e.plugin ?? "core"}
                          </span>
                        </span>
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            openDetail(e.uuid);
                          }}
                          className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-sm px-1"
                          title="View details"
                        >
                          ⋯
                        </button>
                      </li>
                    );
                  })}
                </ul>
                )}
              </section>
            )}

            {/* Device cards (default: newest registration first) */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Devices ({devices.length} total)
                </div>
                <select
                  value={sortId}
                  onChange={(e) => {
                    const next = SORT_OPTIONS.find((o) => o.id === e.target.value);
                    if (next) setSortId(next.id); // ignore unknown values defensively
                  }}
                  className="px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 outline-none focus:ring-1 focus:ring-gray-400"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {sorted.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  No matching devices
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {sorted.map((d) => (
                    <div
                      key={d.uuid}
                      onClick={() => openDetail(d.uuid)}
                      onDoubleClick={() => connectTo(d.uuid)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({ x: e.clientX, y: e.clientY, uuid: d.uuid });
                      }}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 ${
                        selectedUuid === d.uuid
                          ? "bg-gray-200 dark:bg-gray-700 border-gray-400 dark:border-gray-500"
                          : "bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <OnlineDot online={d.online} />
                        <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
                          {displayNameOf(d)}
                        </span>
                        {d.remark && d.name && d.name !== d.remark ? (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-300 dark:bg-gray-500 text-gray-700 dark:text-gray-300 truncate">
                            {d.name}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">{systemOf(d)}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Last: {d.lastSeen ? relTime(d.lastSeen) : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Detail sidebar */}
          {selected && (
            <DeviceDetail
              key={selected.uuid}
              device={selected}
              events={events}
              focusRemark={focusRemark}
              onSetRemark={setRemark}
              onDelete={removeDevice}
              onClose={() => setSelectedUuid(null)}
            />
          )}
        </div>
      )}

      {/* Context menu */}
      {menu && menuActions && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="fixed z-50 min-w-40 py-1 rounded-md bg-gray-100 dark:bg-gray-800 shadow-lg border border-gray-300 dark:border-gray-700 text-sm"
            style={{ left: menu.x, top: menu.y }}
          >
            {menuActions.map((a) => (
              <button
                key={a.label}
                onClick={() => {
                  setMenu(null);
                  a.fn();
                }}
                className={`block w-full text-left px-3 py-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${
                  a.danger ? "text-red-500" : "text-gray-800 dark:text-gray-200"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-md bg-gray-900 text-gray-100 text-sm shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
//#endregion

//#region Page shell

function SettingsPage() {
  return (
    <div className="p-6 max-w-4xl flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold mb-1">Settings</h1>
      </div>
      <div>
        <hr className="border-gray-800 dark:border-gray-600" />
        <div className="mt-4">
          <h2 className="text-lg font-semibold mb-3">Device Management</h2>
          <Devices />
        </div>
      </div>
    </div>
  );
}
//#endregion

export default SettingsPage;
