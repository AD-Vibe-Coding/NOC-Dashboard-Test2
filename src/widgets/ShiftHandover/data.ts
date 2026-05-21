import { useEffect, useState } from "react";
import { db, dbReady, schema } from "../../db";

export type ShiftHandover = typeof schema.shift_handovers.$inferSelect;

export function useShiftHandovers() {
  const [handovers, setHandovers] = useState<ShiftHandover[]>([]);
  const [ready, setReady] = useState(false);

  async function refresh() {
    const rows = await db.shift_handovers.list({
      orderBy: { column: "created_at", ascending: false },
      limit: 30,
    });
    setHandovers(rows);
  }

  useEffect(() => {
    dbReady.then(async () => {
      await refresh();
      setReady(true);
    });
  }, []);

  return { handovers, ready, refresh };
}
