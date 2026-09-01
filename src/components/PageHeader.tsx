import type { ReactNode } from "react";

export interface PageHeaderProps {
  /** Page title. */
  title: ReactNode;
  /** Optional subtitle shown under the title. */
  subtitle?: ReactNode;
}

/**
 * Consistent page header (title + optional subtitle).
 *
 * @param props The title and optional subtitle.
 * @returns The rendered header.
 */
export function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">{title}</h1>
      {subtitle && (
        <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
      )}
    </div>
  );
}
