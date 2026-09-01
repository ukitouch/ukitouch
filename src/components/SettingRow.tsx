import type { ReactNode } from "react";

export interface SettingRowProps {
  /** Left-side label of the row. */
  label: ReactNode;
  /** Trailing control in the label row (e.g. a toggle button). */
  action?: ReactNode;
  /** Small helper text below the body. */
  hint?: ReactNode;
  /** Body content. */
  children?: ReactNode;
}

/**
 * A labelled setting row: label + trailing action, then body, then optional hint.
 *
 * @param props The row's label, action, hint and body.
 * @returns The rendered row.
 */
export function SettingRow({ label, action, hint, children }: SettingRowProps) {
  return (
    <div>
      <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400 mb-2">
        <span className="self-center">{label}</span>
        {action}
      </div>
      {children}
      {hint && (
        <p className="text-xs text-gray-600 dark:text-gray-500 rounded-md mt-1">
          {hint}
        </p>
      )}
    </div>
  );
}
