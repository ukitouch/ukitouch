import type { ReactNode } from "react";

export interface SectionHeaderProps {
  children: ReactNode;
  /** Optional control on the right side of the header. */
  action?: ReactNode;
  /** If set, the header renders as a collapsible toggle. */
  onClick?: () => void;
  /** Whether the collapsible section is currently open (shows the chevron). */
  open?: boolean;
}

/**
 * Section heading, optionally collapsible and with a trailing action.
 */
export function SectionHeader({
  children,
  action,
  onClick,
  open,
}: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-2">
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className={`flex items-center gap-1 text-xs font-semibold tracking-wider interactive-text-1`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${open ? "rotate-90" : ""}`}
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          {children}
        </button>
      ) : (
        <div className="text-xs font-semibold tracking-wider text-3">{children}</div>
      )}
      {action}
    </div>
  );
}
