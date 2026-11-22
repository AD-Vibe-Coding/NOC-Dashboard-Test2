import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { parseWorkbook, type UploadKind, type UploadResult } from "./parse-excel";

type SnapshotState = {
  uploads: UploadResult[];
  isRestoring: boolean;
  restoreError: string | null;
  applyUpload: (result: UploadResult) => void;
  clearUploads: () => void;
};

const KINDS: UploadKind[] = ["tickets", "mobility", "calls"];
const Ctx = createContext<SnapshotState | null>(null);

async function restoreKind(kind: UploadKind): Promise<UploadResult | null> {
  const response = await fetch(`/api/team-performance/uploads?kind=${kind}`, { credentials: "include" });
  // Non-managers can mount the global provider too; they simply have no access to this manager-only data.
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(String(payload?.error ?? `Could not restore ${kind} workbook (${response.status})`));
  }

  const payload = await response.json();
  const saved = payload?.upload as {
    id?: number | string;
    filename?: string;
    parsed_data?: string | UploadResult | null;
    data_url?: string | null;
  } | null;
  if (!saved?.filename) return null;

  if (saved.parsed_data) {
    const result = (typeof saved.parsed_data === "string"
      ? JSON.parse(saved.parsed_data)
      : saved.parsed_data) as UploadResult;
    if (result.kind !== kind || result.filename !== saved.filename || !Array.isArray(result.months)) {
      throw new Error(`Saved ${kind} dashboard data is invalid.`);
    }
    const uploadId = Number(saved.id);
    return Number.isSafeInteger(uploadId) && uploadId > 0 ? { ...result, uploadId } : result;
  }

  // Compatibility for rows uploaded before persistence switched to parsed data.
  if (!saved.data_url) return null;
  const fileResponse = await fetch(saved.data_url);
  if (!fileResponse.ok) throw new Error(`Could not read saved ${kind} workbook.`);
  const result = parseWorkbook(kind, saved.filename, await fileResponse.arrayBuffer());
  if (!result.used) throw new Error(`Saved ${kind} workbook has no usable rows.`);
  const uploadId = Number(saved.id);
  return Number.isSafeInteger(uploadId) && uploadId > 0 ? { ...result, uploadId } : result;
}

export function SnapshotProvider({ children }: { children: ReactNode }) {
  const [uploads, setUploads] = useState<UploadResult[]>([]);
  const [isRestoring, setIsRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(KINDS.map(async (kind) => {
      try {
        return { result: await restoreKind(kind), error: null };
      } catch (error) {
        return { result: null, error: error instanceof Error ? error.message : `Could not restore ${kind} workbook.` };
      }
    })).then((restored) => {
      if (cancelled) return;
      setUploads(restored.flatMap(({ result }) => result ? [result] : []));
      const errors = restored.flatMap(({ error }) => error ? [error] : []);
      setRestoreError(errors.length ? errors.join(" ") : null);
      setIsRestoring(false);
    });
    return () => { cancelled = true; };
  }, []);

  const value = useMemo(
    () => ({
      uploads,
      isRestoring,
      restoreError,
      applyUpload: (result: UploadResult) => {
        setUploads((prev) => [result, ...prev.filter((u) => u.kind !== result.kind)].slice(0, 12));
      },
      clearUploads: () => setUploads([]),
    }),
    [uploads, isRestoring, restoreError],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSnapshotUploads() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSnapshotUploads must be used inside SnapshotProvider");
  return ctx;
}
