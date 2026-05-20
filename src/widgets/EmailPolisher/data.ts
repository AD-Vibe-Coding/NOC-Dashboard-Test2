import { useEffect, useState } from "react";
import { desc } from "drizzle-orm";
import { db, dbReady, schema } from "../../db";

export type PolishedEmail = typeof schema.polished_emails.$inferSelect;

export function usePolishedEmails() {
  const [emails, setEmails] = useState<PolishedEmail[]>([]);
  const [ready, setReady] = useState(false);

  async function refresh() {
    const rows = await db
      .select()
      .from(schema.polished_emails)
      .orderBy(desc(schema.polished_emails.created_at))
      .limit(30);
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
