import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Button, ButtonVariant } from "./Button";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** Paint the confirm button red. */
  confirmStyle?: ButtonVariant;
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
          className="fixed inset-0 z-50 !m-0 flex items-center justify-center bg-dim"
          onClick={() => settle(false)}
        >
          <div
            className="rounded-md shadow-lg p-4 w-80 flex flex-col gap-3 bg-window"
            onClick={(e) => e.stopPropagation()}
          >
            {pending.title && (
              <h2 className="text-sm font-semibold text-1">
                {pending.title}
              </h2>
            )}
            <p className="text-sm text-2">
              {pending.message}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => settle(false)}
              >
                {pending.cancelText ?? "Cancel"}
              </Button>
              <Button
                variant={pending.confirmStyle}
                autoFocus
                onClick={() => settle(true)}
              >
                {pending.confirmText ?? "Confirm"}
              </Button>
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
