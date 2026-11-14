/**
 * device-profile CRUD
 */

import { req, withTx } from ".";
import type { DeviceRecord } from "./types";

/** All device profiles (no order). */
export async function listDevices(): Promise<DeviceRecord[]> {
  return withTx(["devices"], "readonly", async (tx) =>
    req(tx.objectStore("devices").getAll())
  );
}

/**
 * Partial update. Returns the updated row or undefined when the device does not exist.
 */
export async function patchDevice(
  uuid: string,
  patch: Partial<Omit<DeviceRecord, "uuid">>
): Promise<DeviceRecord | undefined> {
  return withTx(["devices"], "readwrite", async (tx) => {
    const store = tx.objectStore("devices");
    const existing = await req(store.get(uuid));
    if (!existing) return undefined;
    const next: DeviceRecord = { ...existing, ...patch, uuid };
    await req(store.put(next));
    return next;
  });
}

/** Delete a device profile and its associated event log in one transaction. */
export async function removeDevice(uuid: string): Promise<void> {
  return withTx(["devices", "connectionEvents"], "readwrite", async (tx) => {
    const deviceStore = tx.objectStore("devices");
    const eventStore = tx.objectStore("connectionEvents");
    await req(deviceStore.delete(uuid));
    const keys = await req(eventStore.index("byDevice").getAllKeys(uuid));
    for (const key of keys) {
      await req(eventStore.delete(key));
    }
  });
}
