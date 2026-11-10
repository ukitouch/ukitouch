export interface ToggleProps {
  /** Whether the toggle is on. */
  checked: boolean;
  /** Called with the state it was flipped to. */
  onChange: (checked: boolean) => void;
  /** Accessible name, for when no visible label is next to it. */
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function Toggle({
  checked,
  onChange,
  ariaLabel,
  disabled,
  className = "",
}: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors",
        disabled && "cursor-not-allowed opacity-40",
        checked
          ? "bg-blue-600"
          : "bg-gray-200 dark:bg-gray-700",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        className={[
          "pointer-events-none absolute left-0.5 top-1/2 block h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-5" : "translate-x-1",
        ]
          .filter(Boolean)
          .join(" ")}
      />
    </button>
  );
}