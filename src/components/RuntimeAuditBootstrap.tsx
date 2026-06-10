import { useEffect } from "react";
import { formatRuntimeError, recordRuntimeAuditEvent } from "../lib/runtime-audit";

export function RuntimeAuditBootstrap() {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const formatted = formatRuntimeError(event.error ?? event.message);
      recordRuntimeAuditEvent({
        level: "error",
        source: "window.error",
        label: event.filename ? `Unhandled error @ ${event.filename.split("/").pop()}` : "Unhandled window error",
        message: formatted.message,
        stack: formatted.stack,
        details: event.lineno ? `Line ${event.lineno}${event.colno ? `, column ${event.colno}` : ""}` : undefined,
        url: window.location.pathname,
      });
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const formatted = formatRuntimeError(event.reason);
      recordRuntimeAuditEvent({
        level: "error",
        source: "unhandledrejection",
        label: "Unhandled promise rejection",
        message: formatted.message,
        stack: formatted.stack,
        url: window.location.pathname,
      });
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}
