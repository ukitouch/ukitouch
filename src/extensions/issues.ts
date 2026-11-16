/** An extension load issue. */
export interface ExtensionIssue {
  level: "error" | "warn";
  message: string;
}

const issues = new Map<string, ExtensionIssue>();

/** Record an issue for a directory, replacing any existing one. */
export function recordExtensionIssue(key: string, issue: ExtensionIssue): void {
  issues.set(key, issue);
}

/** Clear a directory's issue, for example after a successful load. */
export function clearExtensionIssue(key: string): void {
  issues.delete(key);
}

/** The recorded issue of a directory, if any. */
export function getExtensionIssue(key: string): ExtensionIssue | undefined {
  return issues.get(key);
}
