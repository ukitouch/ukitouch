import type { ReactNode } from "react";

export interface SectionHeaderProps {
  /** Label text. */
  children: ReactNode;
  /** Optional control on the right side of the header. */
  action?: ReactNode;
  /** If set, the header renders as a collapsible toggle. */
  onClick?: () => void;
  /** Whether the collapsible section is currently open (shows the chevron). */
  open?: boolean;
}

const LABEL_CLASS =
  "text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400";

/**
 * Section heading: an uppercase label, optionally collapsible and with a
 * trailing action.
 *
 * @param props.children The label text.
 * @param props.action Optional control rendered on the right of the header.
 * @param props.onClick When provided, the label renders as a collapsible toggle
 *   that calls this on click.
 * @param props.open Whether the collapsible section is open (rotates the chevron).
 * @returns The rendered header.
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
          className={`flex items-center gap-1 ${LABEL_CLASS} hover:text-gray-800 dark:hover:text-gray-200 select-none`}
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
        <div className={LABEL_CLASS}>{children}</div>
      )}
      {action}
    </div>
  );
}
