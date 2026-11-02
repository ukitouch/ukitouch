export interface ToggleProps {
  /** Whether the toggle is on. */
  checked: boolean;
  /** Called with the state it was flipped to. */
  onChange: (checked: boolean) => void;
  /** Accessible name, for when no visible label is next to it. */
  ariaLabel?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, ariaLabel, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-5 w-10 shrink-0 self-center items-center rounded-lg transition-colors",
        disabled
          ? "cursor-not-allowed opacity-40"
          : "cursor-pointer",
        checked
          ? "bg-blue-600 dark:bg-blue-500"
          : "bg-gray-300 dark:bg-gray-600",
      ].join(" ")}
    >
      <span
        className={[
          "pointer-events-none absolute top-1/2 -translate-y-1/2 h-4 w-4 rounded-md bg-gray-200 transition-transform",
          checked ? "translate-x-5" : "translate-x-1",
        ].join(" ")}
      />
    </button>
  );
}