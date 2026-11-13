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
  confirmStyle?: ButtonVariant;
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const [animateIn, setAnimateIn] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setPending(options);
        setAnimateIn(false);
        requestAnimationFrame(() => {
          setAnimateIn(true);
        });
      }),
    []
  );

  const settle = useCallback((ok: boolean) => {
    setAnimateIn(false);
    setTimeout(() => {
      resolver.current?.(ok);
      resolver.current = null;
      setPending(null);
    }, 150);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, settle]);

  const overlayClasses = animateIn
    ? "opacity-100"
    : "opacity-0";

  const contentClasses = animateIn
    ? "opacity-100 scale-100 translate-y-0"
    : "opacity-0 scale-95 translate-y-2";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className={`fixed inset-0 z-50 !m-0 flex items-center justify-center bg-dim transition-all duration-150 ease-out ${overlayClasses}`}
          onClick={() => settle(false)}
        >
          <div
            className={`rounded-md shadow-lg p-4 w-80 flex flex-col gap-3 bg-window transition-all duration-150 ease-out ${contentClasses}`}
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

/** React hook to show a confirmation dialog. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm outside ConfirmProvider");
  return ctx;
}
