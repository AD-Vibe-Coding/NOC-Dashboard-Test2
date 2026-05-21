import { useEffect, useState } from "react";
import { db, dbReady, schema } from "../../db";

export type TicketSummary = typeof schema.ticket_summaries.$inferSelect;

export function useTicketSummaries() {
  const [summaries, setSummaries] = useState<TicketSummary[]>([]);
  const [ready, setReady] = useState(false);

  async function refresh() {
    const rows = await db.ticket_summaries.list({
      orderBy: { column: "created_at", ascending: false },
      limit: 50,
    });
    setSummaries(rows);
  }

  useEffect(() => {
    dbReady.then(async () => {
      await refresh();
      setReady(true);
    });
  }, []);

  return { summaries, ready, refresh };
}
