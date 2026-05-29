import { useEffect, useMemo, useState } from "react";
import { useIdentity } from "./identity";

type UpcomingTraining = { id: number; created_at?: string };

function getStorageKey(viewer: string) {
  return `training-updates:last-seen:${viewer}`;
}

export function markTrainingUpdatesSeen(viewer: string) {
  localStorage.setItem(getStorageKey(viewer), new Date().toISOString());
}

export function useTrainingNotifications() {
  const { identity } = useIdentity();
  const viewer = identity?.email ?? identity?.name ?? "anonymous";
  const [upcoming, setUpcoming] = useState<UpcomingTraining[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/upcoming_trainings");
        const json = await res.json().catch(() => ({ trainings: [] }));
        if (!alive) return;
        setUpcoming(json.trainings ?? []);
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const pendingCount = useMemo(() => {
    const lastSeen = localStorage.getItem(getStorageKey(viewer));
    const lastSeenTime = lastSeen ? Date.parse(lastSeen) : 0;
    return upcoming.filter((item) => {
      const created = item.created_at ? Date.parse(item.created_at) : 0;
      return Number.isFinite(created) && created > lastSeenTime;
    }).length;
  }, [upcoming, viewer]);

  return { pendingCount, hasPending: pendingCount > 0, loading };
}
