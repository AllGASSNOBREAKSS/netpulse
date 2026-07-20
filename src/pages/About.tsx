import { Button } from "@/components/ui/button";
import { GithubIcon, Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Section } from "@/components/np/Layout";

const REPO = "https://github.com/bbarc0de/netpulse";

const SECTIONS: { id: string; title: string; body: string[] }[] = [
  {
    id: "what",
    title: "What NetPulse is",
    body: [
      "NetPulse is an open-source internet health console. It measures download and upload throughput, idle and loaded latency, jitter, bufferbloat, and stability from your browser — then explains what the numbers mean, what's wrong, and what to do about it.",
    ],
  },
  {
    id: "why",
    title: "Why it was built",
    body: [
      "Ordinary speed tests answer one question — 'how fast?' — and hide the ones that matter: why does the connection feel bad during calls, why does gaming lag when someone streams, why do two tests disagree, and whether a more expensive plan would actually help.",
      "NetPulse was built to answer those questions with measurements instead of marketing.",
    ],
  },
  {
    id: "problem",
    title: "The problem it solves",
    body: [
      "Most people are told their internet is 'fine' because a headline number looks big. That number is measured at idle, over a few seconds, against a nearby server — the exact conditions under which almost every connection looks good.",
      "The failures people actually experience happen under load, over time, and in the parts of the house furthest from the router. NetPulse measures those conditions on purpose, and gives you evidence you can act on or take to your ISP.",
    ],
  },
  {
    id: "different",
    title: "How it differs from basic speed tests",
    body: [
      "Latency is measured under load, not just at idle — that's where 'fast but feels slow' connections get caught. Bufferbloat is graded per direction with a documented formula. Every result carries a confidence score, the raw samples are inspectable and exportable, and the guided Fix My Internet flow isolates bottlenecks with before/after evidence.",
      "When something can't be measured honestly from a browser (true packet loss, LAN device lists), NetPulse says so instead of inventing a number.",
    ],
  },
  {
    id: "privacy",
    title: "Privacy-first",
    body: [
      "There is no backend, no account, and no analytics. Results live in your browser's local storage. Your public IP is masked by default in the interface and never included in exports or shared reports.",
    ],
  },
  {
    id: "transparency",
    title: "Measurement transparency",
    body: [
      "Tests run against Cloudflare's anycast speed endpoints over HTTPS. Throughput is the median of the top half of multi-connection samples; latency uses monotonic high-resolution timing; the health-score formula lives in one documented source file and is rendered verbatim in the score breakdown panel.",
      "Results will differ from Ookla, Fast.com, or M-Lab — different servers, different methods. NetPulse documents its methodology rather than tuning results to match anyone.",
    ],
  },
  {
    id: "accessibility",
    title: "Accessibility",
    body: [
      "NetPulse is built to be usable with a keyboard alone: every control is reachable by Tab and shows a visible focus ring, dialogs and drawers trap focus and close on Escape, and headings follow a real document outline for screen readers.",
      "Colour is never the only signal — status is always carried by a word as well as a hue. Charts and gauges expose their measured values as text. If your system requests reduced motion, animation is disabled throughout rather than merely shortened.",
      "If you hit an accessibility barrier, please open an issue on GitHub — those are treated as bugs, not enhancements.",
    ],
  },
  {
    id: "open-source",
    title: "Open-source mission",
    body: [
      "Measurement tools should be auditable. If a tool tells you your connection is bad, you should be able to read exactly how it decided that. NetPulse is AGPL-3.0 licensed so the measurement code — and any hosted derivative of it — stays inspectable.",
    ],
  },
  {
    id: "roadmap",
    title: "Roadmap",
    body: [
      "In development: Area Pulse (regional outage awareness), Plan Reality Check (measured performance vs. what you pay for), saved diagnostic reports, and the NetPulse Companion for LAN-side visibility that browsers can't provide.",
      "Roadmap items ship when they can be built on real measurements — not before. Unfinished features are shown as unfinished rather than filled with placeholder data.",
    ],
  },
];

export function AboutPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border/80 bg-background/80 backdrop-blur-xl">
        <div className="np-container flex h-14 items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-2.5 rounded-md" aria-label="NetPulse home">
            <Logo size={24} />
            <span className="font-wordmark text-[17px] font-extrabold tracking-tight">
              net<span className="text-primary">pulse</span>
            </span>
          </a>
          <div className="flex items-center gap-2">
            <a
              href={REPO}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-[13px] font-medium transition-colors hover:border-foreground/25 hover:bg-accent"
            >
              <GithubIcon className="size-4" />
              <span className="hidden sm:inline">Star on GitHub</span>
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="np-container max-w-3xl py-14">
        <div className="space-y-3">
          <h1 className="text-[34px] font-semibold leading-tight tracking-tight">About NetPulse</h1>
          <p className="text-[16px] text-muted-foreground">Understand your internet beyond speed.</p>
        </div>

        <nav aria-label="On this page" className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-y border-border py-4">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-sm text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {s.title}
            </a>
          ))}
        </nav>

        <div className="mt-12 space-y-12">
          {SECTIONS.map((s) => (
            <Section key={s.id} id={s.id} title={s.title} className="scroll-mt-20">
              <div className="space-y-4 text-[15px] leading-[1.75] text-muted-foreground">
                {s.body.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </Section>
          ))}

          <Section title="Contribute">
            <div className="space-y-4 text-[15px] leading-[1.75] text-muted-foreground">
              <p>
                NetPulse is AGPL-3.0 open source. Issues, measurement-methodology critiques, and pull
                requests are all welcome — the measurement code is deliberately readable.
              </p>
              <Button asChild className="gap-2">
                <a href={REPO} target="_blank" rel="noopener noreferrer">
                  <GithubIcon className="size-4" /> Contribute on GitHub
                </a>
              </Button>
            </div>
          </Section>
        </div>

        <footer className="mt-16 space-y-1 border-t border-border pt-6 text-[12.5px] leading-relaxed text-muted-foreground">
          <p>© 2026 NetPulse and contributors. Open-source software licensed under AGPL-3.0.</p>
          <p className="text-muted-foreground/75">
            NetPulse is an independent project and is not affiliated with Ookla, Netflix, Speedtest,
            or FAST.com.
          </p>
        </footer>
      </main>
    </div>
  );
}
