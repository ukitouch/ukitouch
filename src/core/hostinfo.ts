import { invoke } from "@tauri-apps/api/core";
import { Platform } from "./types";

export interface HostInfo {
  name: string | null;
  platform: Platform | null;
  os: string | null;
}

let cached: HostInfo | null = null;

/** Host info, resolved once and cached. */
export async function getHostInfo(): Promise<HostInfo> {
  try {
    const info = await invoke<HostInfo>("get_host_info");
    cached = {
      name: info.name,
      platform: normalizePlatform(info.platform),
      os: info.os,
    };
  } catch {
    // Not running under Tauri: best-effort UA data, no hostname.
    cached = { name: null, platform: platformFromUA(), os: osFromUA() };
  }

  return cached;
}

function platformFromUA(): Platform | null {
  const ua = navigator.userAgent;
  if (/windows/i.test(ua)) return "windows";
  if (/android/i.test(ua)) return "android";
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
  const android = ua.match(/Android (\d+(?:\.\d+)?)/);
  if (android) return `Android ${android[1]}`;
  if (/linux/i.test(ua)) return "Linux";
  return null;
}

function normalizePlatform(p: string | null): Platform | null {
  switch (p) {
    case "windows":
    case "linux":
    case "android":
      return p;
    default:
      return null;  // Unsupported platforms will fall back to null for now.
  }
}
