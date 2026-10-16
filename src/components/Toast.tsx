import { createContext, useCallback, useContext, useEffect, useState } from "react";
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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 3000);
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
          <div
            key={t.id}
            className={`px-4 py-2 rounded-md shadow-lg text-sm text-gray-100 ${t.kind === "error" ? "bg-red-800" : "bg-gray-800"
              }`}
          >
            {t.message}
          </div>
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