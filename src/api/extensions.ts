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

/**
 * Bridge an extension's pipe address into a P2P channel.
 * 
 * TODO: only p2p?
 */
export async function pipeBind(
  token: string,
  channelId: number,
  addr: string
): Promise<{ id: number }> {
  return invoke("pipe_bind", { token, channelId, addr });
}

/** Close a pipe. */
export async function pipeUnbind(id: number): Promise<void> {
  return invoke("pipe_unbind", { id });
}
