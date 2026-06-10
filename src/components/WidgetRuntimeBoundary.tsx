import type { ReactNode } from "react";
import { ErrorBoundary } from "./ErrorBoundary";

export function WidgetRuntimeBoundary({ label, compact = false, children }: { label: string; compact?: boolean; children: ReactNode }) {
  return (
    <ErrorBoundary label={label} compact={compact}>
      {children}
    </ErrorBoundary>
  );
}
