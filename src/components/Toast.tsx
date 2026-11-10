import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/** Toast severity. */
export type ToastKind = "info" | "error";

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastApi {
  show(message: string, kind?: ToastKind): void;
}

const ToastContext = createContext<ToastApi | null>(null);

const VISIBLE_MS = 3000;
const FADE_MS = 300;

function ToastItem({ toast, onDone }: { toast: Toast; onDone(id: number): void }) {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const start = useCallback(() => {
    stop();
    timer.current = window.setTimeout(() => setLeaving(true), VISIBLE_MS);
  }, [stop]);

  useEffect(() => {
    start();
    return stop;
  }, [start, stop]);

  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => onDone(toast.id), FADE_MS);
    return () => window.clearTimeout(t);
  }, [leaving, onDone, toast.id]);

  return (
    <div
      onMouseEnter={stop}
      onMouseLeave={() => {
        if (!leaving) start();
      }}
      className={`px-4 py-2 rounded-md shadow-lg text-sm text-1 transition-opacity duration-300 ${toast.kind === "error" ? "bg-danger" : "bg-window"
        } ${leaving ? "opacity-0" : "opacity-100"}`}
    >
      {toast.message}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
  }, []);

  const remove = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  // expose `show` outside React
  useEffect(() => {
    setToastSink(show);
    return () => setToastSink(null);
  }, [show]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast outside ToastProvider");
  return ctx;
}

let toastImpl: ((message: string, kind?: ToastKind) => void) | null = null;

/**
 * The React toast provider registers here.
 *
 * @param fn The toast function, or `null` to unregister.
 */
function setToastSink(fn: ((message: string, kind?: ToastKind) => void) | null): void {
  toastImpl = fn;
}

/**
 * Show a toast if a sink is wired.
 *
 * @param message The message to show.
 * @param kind The severity, defaults to "info".
 */
export function showToast(message: string, kind?: ToastKind): void {
  toastImpl?.(message, kind);
}