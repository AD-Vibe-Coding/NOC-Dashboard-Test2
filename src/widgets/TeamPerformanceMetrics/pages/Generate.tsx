import { FormEvent, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Check, Copy, PenLine } from "lucide-react";
import { BlurFade } from "@/widgets/TeamPerformanceMetrics/components/ui/blur-fade";
import { Button } from "@/widgets/TeamPerformanceMetrics/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/widgets/TeamPerformanceMetrics/components/ui/card";
import { Label } from "@/widgets/TeamPerformanceMetrics/components/ui/label";
import { Textarea } from "@/widgets/TeamPerformanceMetrics/components/ui/textarea";

export default function Generate() {
  const [prompt, setPrompt] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const brief = prompt.trim();
    if (!brief) return;
    setBusy(true);
    setErr("");
    setCopied(false);
    try {
      const res = await fetch("/api/team-performance/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: brief }),
      });
      const data = (await res.json()) as { content?: string; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setContent(data.content || "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyOut() {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="space-y-8">
      <BlurFade>
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">GPT-5.4</p>
          <h1 className="font-display mt-1 text-3xl md:text-4xl">Generate</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Describe the article, summary, description, or post you need. The model returns polished copy you can copy.
          </p>
        </div>
      </BlurFade>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <PenLine className="size-4" />
              Brief
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="brief">What should we write?</Label>
                <Textarea
                  id="brief"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={10}
                  placeholder="e.g. Weekly NOC summary for leadership: ticket volume rose 12%, Comcast maintenance was the main driver, keep it under 200 words."
                />
              </div>
              {err ? <p className="text-sm text-destructive">{err}</p> : null}
              <Button type="submit" disabled={busy || !prompt.trim()}>
                {busy ? "Writing…" : "Generate with GPT-5.4"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base font-medium">Draft</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={copyOut} disabled={!content}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </CardHeader>
          <CardContent>
            {content ? (
              <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:my-3">
                <ReactMarkdown>{content}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Generated copy will appear here. Empty until you run a brief.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
