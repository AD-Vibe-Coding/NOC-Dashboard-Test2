import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { Sparkles } from "lucide-react";
import { useSnapshotUploads } from "@/widgets/TeamPerformanceMetrics/lib/snapshot-store";
import { hasLiveData, liveInsights, periodLabelsLive } from "@/widgets/TeamPerformanceMetrics/lib/live-data";
import { Card, CardContent } from "@/widgets/TeamPerformanceMetrics/components/ui/card";
import { Button } from "@/widgets/TeamPerformanceMetrics/components/ui/button";
import { BlurFade } from "@/widgets/TeamPerformanceMetrics/components/ui/blur-fade";

function cleanMarkdown(raw: string) {
  return raw
    .replace(/\\([*_])/g, "$1")
    .replace(/\r\n/g, "\n")
    .trim();
}

export default function Insights() {
  const { uploads } = useSnapshotUploads();
  const live = hasLiveData(uploads);
  const labels = periodLabelsLive("month");
  const facts = liveInsights(uploads, "month", Math.max(0, labels.length - 1));
  const [briefing, setBriefing] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function runAi() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/team-performance/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: facts,
          question:
            "Analyze the last 13 months of tickets. Cover volume, issue types (M), resolutions (X), Tech Support vs manual (Y), time to open with carrier (AG) and which carriers drive it, hour of day (AX), and day of week (AW). Write an executive briefing of the patterns.",
        }),
      });
      const data = (await res.json()) as { briefing?: string; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setBriefing(data.briefing || "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI request failed");
    } finally {
      setBusy(false);
    }
  }

  if (!live) {
    return (
      <div className="space-y-8">
        <BlurFade>
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">NOC</p>
            <h1 className="font-display mt-1 text-3xl md:text-4xl">Insights</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Upload tickets first, then analyze the last 13 months for issue, resolution, source, carrier-open time, hour, and day patterns.
            </p>
          </div>
        </BlurFade>
        <Card>
          <CardContent className="flex flex-col items-start gap-4 py-10">
            <p className="text-sm text-muted-foreground">No file loaded.</p>
            <Button asChild>
              <Link to="/upload">Upload Excel</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <BlurFade>
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">NOC</p>
          <h1 className="font-display mt-1 text-3xl md:text-4xl">Insights</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Pattern analysis for {facts.window}. Re-upload tickets so issue type, resolution, source, AG, day, and hour are included.
          </p>
        </div>
      </BlurFade>

      <Button size="lg" onClick={runAi} disabled={busy} className="gap-2">
        <Sparkles className="size-4" />
        {busy ? "Analyzing…" : briefing ? "Refresh analysis" : "Analyze with AI"}
      </Button>

      {err ? <p className="text-sm text-destructive">{err}</p> : null}

      {briefing ? (
        <Card className="overflow-hidden">
          <CardContent className="px-6 py-8 sm:px-8">
            <article className="prose prose-neutral dark:prose-invert max-w-none prose-p:my-3 prose-p:leading-7 prose-p:text-[15px] prose-strong:font-semibold prose-strong:text-foreground prose-headings:font-display prose-headings:tracking-tight prose-h2:mt-6 prose-h2:mb-2 prose-h2:text-lg prose-ul:my-3 prose-li:my-1">
              <ReactMarkdown
                components={{
                  strong: ({ children }: { children?: ReactNode }) => (
                    <strong className="font-semibold text-foreground">{children}</strong>
                  ),
                }}
              >
                {cleanMarkdown(briefing)}
              </ReactMarkdown>
            </article>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
