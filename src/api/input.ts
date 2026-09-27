import { invoke } from "@tauri-apps/api/core";

/** A point on the peer's screen, in pixels. */
export interface Point {
  x: number;
  y: number;
}

/** A pointer button. */
export type MouseButton = "left" | "middle" | "right" | "back" | "forward";

/** A synthesized input event, in screen pixels. */
export type InputEvent =
  | { kind: "move"; x: number; y: number }
  | { kind: "button"; at?: Point; button: MouseButton; pressed: boolean }
  | { kind: "scroll"; at?: Point; dx: number; dy: number }
  | { kind: "key"; keysym: number; pressed: boolean };

/** Bring the input backend up. Idempotent. */
export async function startInput(): Promise<void> {
  await invoke("input_start");
}

/** Synthesize a batch of events, in order. */
export async function injectInput(events: InputEvent[]): Promise<void> {
  await invoke("input_inject", { events });
}

/** Release everything held down. */
export async function releaseInput(): Promise<void> {
  await invoke("input_release");
}

/** Release and drop the backend. */
export async function stopInput(): Promise<void> {
  await invoke("input_stop");
}
