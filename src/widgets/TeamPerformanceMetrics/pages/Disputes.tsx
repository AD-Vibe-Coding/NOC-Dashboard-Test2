import { useCallback } from "react";
import { Gavel } from "lucide-react";
import { useIdentity } from "../../../lib/identity";
import { DisputesPanel } from "../../PerformanceTracker/DisputesPanel";
import { resolveTeamMember } from "../../PerformanceTracker/team";

export default function Disputes() {
  const { identity } = useIdentity();
  const isManager = identity?.role === "manager";
  const currentUserName = identity
    ? resolveTeamMember(identity.name) ?? identity.name
    : undefined;
  const reviewerName = isManager ? currentUserName ?? "Manager" : "";
  const onMetricsChanged = useCallback(() => {}, []);

  return (
    <section className="space-y-5" aria-labelledby="disputes-title">
      <header className="flex items-start gap-3 border-b border-border pb-4">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary" aria-hidden="true">
          <Gavel className="size-4" />
        </span>
        <div>
          <h1 id="disputes-title" className="font-display text-2xl font-semibold tracking-tight">
            Disputes
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {isManager
              ? "Review submitted disputes, approve or reject pending requests, and check past decisions."
              : "Track your submitted disputes and see the outcome of each review."}
          </p>
        </div>
      </header>
      <DisputesPanel
        reviewerName={reviewerName}
        onMetricsChanged={onMetricsChanged}
        isManager={isManager}
        currentUserName={currentUserName}
      />
    </section>
  );
}
