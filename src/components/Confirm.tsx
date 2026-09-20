import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** Paint the confirm button red. */
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setPending(options);
      }),
    []
  );

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setPending(null);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => settle(false)}
        >
          <div
            className="bg-gray-100 dark:bg-gray-800 rounded-md shadow-lg p-4 w-80 flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            {pending.title && (
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                {pending.title}
              </h2>
            )}
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {pending.message}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => settle(false)}
                className="px-3 py-1.5 rounded-md text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100"
              >
                {pending.cancelText ?? "Cancel"}
              </button>
              <button
                autoFocus
                onClick={() => settle(true)}
                className={`px-3 py-1.5 rounded-md text-sm text-gray-100 ${pending.danger
                    ? "bg-red-700 hover:bg-red-600"
                    : "bg-gray-700 hover:bg-gray-600"
                  }`}
              >
                {pending.confirmText ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm outside ConfirmProvider");
  return ctx;
}
