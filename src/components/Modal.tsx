// TODO: will inplement one Modal allowed on the screen

import { useEffect, useRef, useState } from "react";

export interface ModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Called when the modal is closed. */
  onClose: () => void;
  /** The modal title. */
  title?: string;
  children: React.ReactNode;
  /** Default to "max-w-2xl" */
  width?: string;
  /** Default "max-h-[90vh]" */
  height?: string;
}

/**
 * A modal component.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  width = "max-w-2xl",
  height = "max-h-[90vh]",
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const originalOverflowRef = useRef<string>("");
  const [mounted, setMounted] = useState(false);
  const [animateIn, setAnimateIn] = useState(false);

  // animation
  useEffect(() => {
    if (open) {
      setMounted(true);
      setAnimateIn(false);

      const raf = requestAnimationFrame(() => {
        setAnimateIn(true);
      });
      return () => cancelAnimationFrame(raf);
    } else {
      setAnimateIn(false);
      const timer = setTimeout(() => {
        setMounted(false);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    if (!mounted) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);

    originalOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = originalOverflowRef.current;
    };
  }, [mounted, onClose]);

  if (!mounted) return null;

  const overlayClasses = animateIn
    ? "opacity-100"
    : "opacity-0";

  const contentClasses = animateIn
    ? "opacity-100 scale-100 translate-y-0"
    : "opacity-0 scale-95 translate-y-2";

  return (
    <div
      ref={overlayRef}
      className={`fixed inset-0 z-50 !m-0 flex items-center justify-center bg-dim transition-all duration-200 ease-out ${overlayClasses}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full ${width} ${height} mx-5 rounded-lg flex flex-col overflow-hidden bg-window transition-all duration-200 ease-out ${contentClasses}`}
      >
        {title && (
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0 divider">
            <h2 className="text-lg font-semibold text-1">{title}</h2>
            <button
              onClick={onClose}
              className="p-1 rounded transition-colors interactive-text-1"
              title="Close"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        )}
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
