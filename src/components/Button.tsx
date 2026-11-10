import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "danger" | "dangerFill";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. Defaults to `primary`. */
  variant?: ButtonVariant;
  children?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "button-primary text-2",
  danger: "button-danger",
  dangerFill: "button-danger-fill"
};

/**
 * Shared button with a small set of variants.
 *
 * @param props Button props; `className` is appended to the base styles.
 * @returns The rendered button.
 */
export function Button({
  variant = "primary",
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
