//! TODO: may replace with the upstream switch once it exists: WebKitGTK
//! `enable-pinch-zoom-gesture` or a wry option (tauri-apps/wry#544,
//! tauri-apps/tauri#13115).

import { listen } from "@tauri-apps/api/event";

/** One pinch frame forwarded by the native gesture (WebKitGTK). */
interface NativePinch {
  phase: "start" | "move" | "end";
  /** cumulative scale since the gesture began */
  scale: number;
  // center of the pinch in CSS pixels of the page
  x: number;
  y: number;
}

type Handler = (frame: NativePinch) => void;

const areas = new Map<HTMLElement, Handler>();
/** the area the running gesture belongs to until it ends */
let owner: HTMLElement | null = null;
let subscribed = false;

/**
 * Take native pinches while `el` is mounted.
 *
 * @param el element to hit-test and report frames to
 * @param handler called for every frame of a gesture that belongs to `el`
 * @returns function that stops watching for this element
 */
export function watchPinch(el: HTMLElement, handler: Handler): () => void {
  areas.set(el, handler);
  subscribe();
  return () => {
    areas.delete(el);
    if (owner === el) owner = null;
  };
}

function subscribe(): void {
  if (subscribed) return;
  subscribed = true;
  void listen<NativePinch>("ukitouch://pinch", ({ payload }) => {
    if (payload.phase === "start") owner = topmost(payload.x, payload.y);
    if (!owner) return;
    const target = owner;
    if (payload.phase === "end") owner = null;
    areas.get(target)?.(payload);
  });
}

function topmost(x: number, y: number): HTMLElement | null {
  const registered = [...areas.keys()].reverse();
  for (const el of registered) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return el;
  }
  return null;
}
