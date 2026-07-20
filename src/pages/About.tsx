import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GithubIcon, Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

const REPO = "https://github.com/bbarc0de/netpulse";

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "What NetPulse is",
    body: [
      "NetPulse is an open-source internet health console. It measures download and upload throughput, idle and loaded latency, jitter, bufferbloat, and stability from your browser — then explains what the numbers mean, what's wrong, and what to do about it.",
    ],
  },
  {
    title: "Why it was built",
    body: [
      "Ordinary speed tests answer one question — 'how fast?' — and hide the ones that matter: why does the connection feel bad during calls, why does gaming lag when someone streams, why do two tests disagree, and whether a more expensive plan would actually help.",
      "NetPulse was built to answer those questions with measurements instead of marketing.",
    ],
  },
  {
    title: "How it differs from basic speed tests",
    body: [
      "Latency is measured under load, not just at idle — that's where 'fast but feels slow' connections get caught. Bufferbloat is graded per direction with a documented formula. Every result carries a confidence score, the raw samples are inspectable and exportable, and the guided Fix My Internet flow isolates bottlenecks with before/after evidence.",
      "When something can't be measured honestly from a browser (true packet loss, LAN device lists), NetPulse says so instead of inventing a number.",
    ],
  },
  {
    title: "Privacy-first",
    body: [
      "There is no backend, no account, and no analytics. Results live in your browser's local storage. Your public IP is masked by default in the interface and never included in exports or shared reports.",
    ],
  },
  {
    title: "Measurement transparency",
    body: [
      "Tests run against Cloudflare's anycast speed endpoints over HTTPS. Throughput is the median of the top half of multi-connection samples; latency uses monotonic high-resolution timing; the health-score formula lives in one documented source file and is rendered verbatim in the score breakdown panel.",
      "Results will differ from Ookla, Fast.com, or M-Lab — different servers, different methods. NetPulse documents its methodology rather than tuning results to match anyone.",
    ],
  },
  {
    title: "Roadmap",
    body: [
      "In development: Area Pulse (regional outage awareness), Plan Reality Check (measured performance vs. what you pay for), saved diagnostic reports, and the NetPulse Companion for LAN-side visibility that browsers can't provide. Roadmap items ship when they can be built on real measurements — not before.",
    ],
  },
];

export function AboutPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b bg-background/85 px-5 backdrop-blur-md">
        <a href="/" className="flex items-center gap-2.5">
          <Logo size={26} />
          <span className="font-wordmark text-lg font-extrabold">
            net<span className="text-primary">pulse</span>
          </span>
        </a>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild className="gap-1.5">
            <a href={REPO} target="_blank" rel="noopener noreferrer">
              <GithubIcon className="size-4" /> Star on GitHub
            </a>
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-5 py-10">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">About NetPulse</h1>
          <p className="text-muted-foreground">Understand your internet beyond speed.</p>
        </div>

        {SECTIONS.map((s) => (
          <Card key={s.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{s.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-[14px] leading-relaxed text-muted-foreground">
              {s.body.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </CardContent>
          </Card>
        ))}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Contribute</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-[14px] text-muted-foreground">
            <p>
              NetPulse is AGPL-3.0 open source. Issues, measurement-methodology critiques, and pull
              requests are all welcome — the measurement code is deliberately readable.
            </p>
            <Button asChild className="gap-1.5">
              <a href={REPO} target="_blank" rel="noopener noreferrer">
                <GithubIcon className="size-4" /> Contribute on GitHub
              </a>
            </Button>
          </CardContent>
        </Card>

        <footer className="space-y-1 border-t pt-5 text-[12.5px] text-muted-foreground">
          <p>© 2026 NetPulse and contributors. Open-source software licensed under AGPL-3.0.</p>
          <p>NetPulse is an independent project and is not affiliated with Ookla, Netflix, Speedtest, or FAST.com.</p>
        </footer>
      </main>
    </div>
  );
}
