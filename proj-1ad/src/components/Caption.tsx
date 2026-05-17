import type { ReactNode } from "react";

// Tracked-uppercase JetBrains Mono label. Used for section headings and
// the dim meta strips throughout the dashboard.
export function Caption({ children }: { children: ReactNode }) {
  return <div className="caption">{children}</div>;
}
