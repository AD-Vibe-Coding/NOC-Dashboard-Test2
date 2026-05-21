import { useEffect, useState } from "react";
import { db, dbReady, schema } from "../../db";

export type EscalationDraft = typeof schema.escalation_drafts.$inferSelect;

export function useEscalationDrafts() {
  const [drafts, setDrafts] = useState<EscalationDraft[]>([]);
  const [ready, setReady] = useState(false);

  async function refresh() {
    const rows = await db.escalation_drafts.list({
      orderBy: { column: "created_at", ascending: false },
      limit: 50,
    });
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
