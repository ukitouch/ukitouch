import type { ReactNode } from "react";

export interface PageHeaderProps {
  /** Page title. */
  title: ReactNode;
  /** Optional subtitle shown under the title. */
  subtitle?: ReactNode;
}

/**
 * Page header (title + optional subtitle).
 */
export function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">{title}</h1>
      {subtitle && (
        <p className="text-sm text-3">{subtitle}</p>
      )}
    </div>
  );
}
