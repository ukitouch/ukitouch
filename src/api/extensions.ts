/** Host-side: talk to native extensions. */
import { invoke } from "@tauri-apps/api/core";

/** Call a method on a native extension. */
export async function nativeCall<T = unknown>(
  extId: string,
  method: string,
  payload: unknown = null
): Promise<T> {
  return invoke<T>("native_call", { extId, method, payload });
}
