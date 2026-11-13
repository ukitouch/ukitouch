import type { ReactNode } from "react";

export interface SettingRowProps {
  /** Left-side label of the row. */
  label: ReactNode;
  /** Trailing control in the label row (e.g. a toggle button). */
  action?: ReactNode;
  /** Small helper text below the body. */
  hint?: ReactNode;
  children?: ReactNode;
}

/**
 * A labelled setting row.
 */
export function SettingRow({ label, action, hint, children }: SettingRowProps) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-2 text-1">
        <span className="self-center">{label}</span>
        {action}
      </div>
      {children}
      {hint && (
        <p className="text-xs rounded-md mt-1 text-3">
          {hint}
        </p>
      )}
    </div>
  );
}
