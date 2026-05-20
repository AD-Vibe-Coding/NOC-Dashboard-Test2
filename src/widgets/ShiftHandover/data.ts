import { useEffect, useState } from "react";
import { desc } from "drizzle-orm";
import { db, dbReady, schema } from "../../db";

export type ShiftHandover = typeof schema.shift_handovers.$inferSelect;

export function useShiftHandovers() {
  const [handovers, setHandovers] = useState<ShiftHandover[]>([]);
  const [ready, setReady] = useState(false);

  async function refresh() {
    const rows = await db
      .select()
      .from(schema.shift_handovers)
      .orderBy(desc(schema.shift_handovers.created_at))
      .limit(30);
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
