// TODO: will inplement one Modal allowed on the screen

import { useEffect, useRef } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Default to "max-w-2xl" */
  width?: string;
  /** Default "max-h-[90vh]" */
  height?: string;
}

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

  useEffect(() => {
    if (!open) return;

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
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`
          w-full ${width} bg-gray-900 rounded-lg shadow-2xl border border-gray-700
          flex flex-col overflow-hidden
          ${height}
        `}
      >
        {title && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
            <h2 className="text-lg font-semibold text-gray-100">{title}</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-100 p-1 rounded hover:bg-gray-800 transition-colors"
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
