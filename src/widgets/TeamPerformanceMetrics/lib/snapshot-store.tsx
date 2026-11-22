import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { UploadResult } from "./parse-excel";

type SnapshotState = {
  uploads: UploadResult[];
  applyUpload: (result: UploadResult) => void;
  clearUploads: () => void;
};

const Ctx = createContext<SnapshotState | null>(null);

export function SnapshotProvider({ children }: { children: ReactNode }) {
  const [uploads, setUploads] = useState<UploadResult[]>([]);
  const value = useMemo(
    () => ({
      uploads,
      applyUpload: (result: UploadResult) => {
        setUploads((prev) => [result, ...prev.filter((u) => u.kind !== result.kind)].slice(0, 12));
      },
      clearUploads: () => setUploads([]),
    }),
    [uploads],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSnapshotUploads() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSnapshotUploads must be used inside SnapshotProvider");
  return ctx;
}
