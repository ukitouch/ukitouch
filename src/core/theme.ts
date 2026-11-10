import { invoke } from "@tauri-apps/api/core";

export type ThemeMode = "system" | "light" | "dark";

const KEY = "ukitouch.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

let mode = readMode();

function readMode(): ThemeMode {
  const saved = localStorage.getItem(KEY);
  return saved === "light" || saved === "dark" ? saved : "system";
}

function isDark(): boolean {
  return mode === "dark" || (mode === "system" && media.matches);
}

function apply(): void {
  const dark = isDark();
  document.documentElement.classList.toggle("dark", dark);
  invoke("set_system_theme", { dark }).catch(() => {});
}

function emit(): void {
  listeners.forEach((fn) => fn());
}

export const themeStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get(): ThemeMode {
    return mode;
  },
  set(next: ThemeMode): void {
    mode = next;
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
    apply();
    emit();
  },
};

media.addEventListener("change", () => {
  if (mode !== "system") return;
  apply();
  emit();
});

apply();
