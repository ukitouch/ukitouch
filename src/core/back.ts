import { useEffect } from "react";

type BackFn = () => boolean;

let handler: BackFn | null = null;
let fallback: BackFn | null = null;

/**
 * Set (or clear with `null`) the current back handler.
 *
 * Return `true` when the handler consumed the press.
 * Returning `false` (or no handler) falls back to the shell
 * default: leave the current page, or quit on Home.
 */
export function setBackHandler(fn: BackFn | null): () => void {
  handler = fn;
  return () => {
    if (handler === fn) handler = null;
  };
}

export function setBackFallback(fn: BackFn | null): void {
  fallback = fn;
}

/**
 * Handle one hardware back press.
 *
 * @returns `true` when the press was consumed.
 */
export function invokeBack(): boolean {
  if (handler?.()) return true;
  if (fallback?.()) return true;
  return false;
}

/**
 * Set (or clear with `null`) the current back handler.
 *
 * Return `true` when the handler consumed the press.
 * Returning `false` (or no handler) falls back to the shell
 * default: leave the current page, or quit on Home.
 */
export function useBack(fn: BackFn | null): void {
  useEffect(() => setBackHandler(fn), [fn]);
}
