/**
 * Host info for the hello handshake: peer-facing name, platform and OS description.
 *
 * Primary source is the Tauri `get_host_info` command (hostname / platform / os
 * from Rust). Outside Tauri (e.g. plain `npm run dev` in a browser) it falls
 * back to best-effort user-agent data with a null hostname.
 */
import { invoke } from "@tauri-apps/api/core";
import type { HelloInfo, Platform } from "./db";

interface TauriHostInfo {
  name: string | null;
  platform: string;
  os: string;
}

let cached: Promise<HelloInfo> | null = null;

/** Host info, resolved once and cached. */
export function getHostInfo(): Promise<HelloInfo> {
  cached ??= fetchHostInfo();
  return cached;
}

async function fetchHostInfo(): Promise<HelloInfo> {
  try {
    const info = await invoke<TauriHostInfo>("get_host_info");
    return {
      name: info.name,
      platform: normalizePlatform(info.platform),
      os: info.os || null,
    };
  } catch {
    // Not running under Tauri: best-effort UA data, no hostname.
    return { name: null, platform: platformFromUA(), os: osFromUA() };
  }
}

function normalizePlatform(p: string): Platform | null {
  switch (p) {
    case "windows":
    case "macos":
    case "linux":
    case "android":
    case "ios":
      return p;
    default:
      return null;
  }
}

function platformFromUA(): Platform | null {
  const ua = navigator.userAgent;
  if (/windows/i.test(ua)) return "windows";
  if (/mac os x|macintosh/i.test(ua)) return "macos";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/linux/i.test(ua)) return "linux";
  return null;
}

function osFromUA(): string | null {
  const ua = navigator.userAgent;
  const win = ua.match(/Windows NT (\d+(?:\.\d+)?)/);
  if (win) {
    const major = Math.floor(parseFloat(win[1]));
    return major >= 10 ? `Windows ${major >= 11 ? 11 : "10/11"}` : `Windows ${win[1]}`;
  }
  const mac = ua.match(/Mac OS X ([\d_.]+)/);
  if (mac) return `macOS ${mac[1].replace(/_/g, ".")}`;
  const android = ua.match(/Android (\d+(?:\.\d+)?)/);
  if (android) return `Android ${android[1]}`;
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/linux/i.test(ua)) return "Linux";
  return null;
}
