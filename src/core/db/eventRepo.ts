/*
 * connectionEvents object store repository.
 */

import { eachCursor, req, withTx } from ".";
import { HostInfo } from "../types";
import {
  MAX_CONNECTION_EVENTS,
  type ConnectionEvent,
  type NewConnectionEvent,
  type DeviceRecord,
} from "./types";

/** Append one event and FIFO-trim the oldest entries beyond the cap. */
export async function appendEvent(
  ev: NewConnectionEvent
): Promise<ConnectionEvent> {
  return withTx(["connectionEvents"], "readwrite", async (tx) => {
    const store = tx.objectStore("connectionEvents");
    const id = await req(store.add(ev));
    await trimEvents(store);
    return { ...ev, id: Number(id) };
  });
}

/**
 * Record a connection: append the event and upsert the device profile projection.
 */
export async function recordConnection(
  ev: NewConnectionEvent,
  hostInfo: HostInfo
): Promise<{ device: DeviceRecord; event: ConnectionEvent }> {
  return withTx(["devices", "connectionEvents"], "readwrite", async (tx) => {
    const deviceStore = tx.objectStore("devices");
    const eventStore = tx.objectStore("connectionEvents");

    const existing = await req(
      deviceStore.get(ev.uuid) as IDBRequest<DeviceRecord | undefined>
    );
    const device: DeviceRecord = existing
      ? {
        ...existing,
        name: hostInfo.name ?? existing.name,
        platform: hostInfo.platform ?? existing.platform,
        os: hostInfo.os ?? existing.os,
        lastSeen: ev.time,
        protocol: ev.protocol,
      }
      : {
        uuid: ev.uuid,
        name: hostInfo.name,
        remark: null,
        platform: hostInfo.platform,
        os: hostInfo.os,
        firstSeen: ev.time,
        lastSeen: ev.time,
        protocol: ev.protocol,
      };
    await req(deviceStore.put(device));

    const id = await req(eventStore.add(ev));
    await trimEvents(eventStore);
    return { device, event: { ...ev, id: Number(id) } };
  });
}

/** All events, ascending by time. */
export async function listAllEvents(): Promise<ConnectionEvent[]> {
  return withTx(["connectionEvents"], "readonly", async (tx) =>
    req(tx.objectStore("connectionEvents").getAll())
  );
}

/** A device's events, descending by time. */
export async function listEventsByDevice(
  uuid: string,
  limit?: number
): Promise<ConnectionEvent[]> {
  return withTx(["connectionEvents"], "readonly", async (tx) => {
    const out: ConnectionEvent[] = [];
    await eachCursor<ConnectionEvent>(
      tx.objectStore("connectionEvents").index("byTime"),
      null,
      "prev",
      (ev) => {
        if (ev.uuid !== uuid) return false;
        out.push(ev);
        return limit !== undefined && out.length >= limit;
      }
    );
    return out;
  });
}

/** Delete the oldest entries once the count exceeds the cap. */
async function trimEvents(store: IDBObjectStore): Promise<void> {
  const index = store.index("byTime");
  const count = await req(index.count());
  if (count <= MAX_CONNECTION_EVENTS) return;

  const keys = await req(index.getAllKeys());
  const excess = keys.length - MAX_CONNECTION_EVENTS;
  for (let i = 0; i < excess; i++) {
    await req(store.delete(keys[i]));
  }
}
