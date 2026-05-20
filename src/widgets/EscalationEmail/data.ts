import { useEffect, useState } from "react";
import { desc } from "drizzle-orm";
import { db, dbReady, schema } from "../../db";

export type EscalationDraft = typeof schema.escalation_drafts.$inferSelect;

export function useEscalationDrafts() {
  const [drafts, setDrafts] = useState<EscalationDraft[]>([]);
  const [ready, setReady] = useState(false);

  async function refresh() {
    const rows = await db
      .select()
      .from(schema.escalation_drafts)
      .orderBy(desc(schema.escalation_drafts.created_at))
      .limit(50);
    setDrafts(rows);
  }

  useEffect(() => {
    dbReady.then(async () => {
      await refresh();
      setReady(true);
    });
  }, []);

  return { drafts, ready, refresh };
}
