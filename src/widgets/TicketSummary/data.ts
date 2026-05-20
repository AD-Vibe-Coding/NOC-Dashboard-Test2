import { useEffect, useState } from "react";
import { desc } from "drizzle-orm";
import { db, dbReady, schema } from "../../db";

export type TicketSummary = typeof schema.ticket_summaries.$inferSelect;

export function useTicketSummaries() {
  const [summaries, setSummaries] = useState<TicketSummary[]>([]);
  const [ready, setReady] = useState(false);

  async function refresh() {
    const rows = await db
      .select()
      .from(schema.ticket_summaries)
      .orderBy(desc(schema.ticket_summaries.created_at))
      .limit(50);
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
