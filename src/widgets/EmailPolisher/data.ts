import { useEffect, useState } from "react";
import { db, dbReady, schema } from "../../db";

export type PolishedEmail = typeof schema.polished_emails.$inferSelect;

export function usePolishedEmails() {
  const [emails, setEmails] = useState<PolishedEmail[]>([]);
  const [ready, setReady] = useState(false);

  async function refresh() {
    const rows = await db.polished_emails.list({
      orderBy: { column: "created_at", ascending: false },
      limit: 30,
    });
    setEmails(rows);
  }

  useEffect(() => {
    dbReady.then(async () => {
      await refresh();
      setReady(true);
    });
  }, []);

  return { emails, ready, refresh };
}
