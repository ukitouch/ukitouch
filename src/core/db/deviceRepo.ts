/**
 * devices object store repository: device-profile CRUD.
 * Persisted shape is `StoredDevice` (derived `online` excluded).
 */
import { req, withTx } from ".";
import type { StoredDevice } from "./types";

/** All device profiles; ordering is left to the caller. */
export async function listDevices(): Promise<StoredDevice[]> {
  return withTx(["devices"], "readonly", async (tx) =>
    req(tx.objectStore("devices").getAll())
  );
}

export async function getDevice(
  uuid: string
): Promise<StoredDevice | undefined> {
  return withTx(["devices"], "readonly", async (tx) =>
    req(tx.objectStore("devices").get(uuid))
  );
}

/**
 * Partial update (e.g. setRemark, hello info). Returns the updated row,
 * or undefined when the device does not exist.
 */
export async function patchDevice(
  uuid: string,
  patch: Partial<Omit<StoredDevice, "uuid">>
): Promise<StoredDevice | undefined> {
  return withTx(["devices"], "readwrite", async (tx) => {
    const store = tx.objectStore("devices");
    const existing = await req(store.get(uuid));
    if (!existing) return undefined;
    const next: StoredDevice = { ...existing, ...patch, uuid };
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
