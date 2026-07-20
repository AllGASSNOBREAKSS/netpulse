import type { ComponentType } from "react";
import { BookOpen, Radar, ScrollText } from "lucide-react";
import { PageHeader, Panel, Section, StatusPill } from "@/components/np/Layout";
import type { View } from "@/lib/views";
import { Button } from "@/components/ui/button";

/**
 * Honest states for features that are designed but not yet measurable.
 *
 * These pages deliberately contain NO sample outages, NO example reports and NO
 * placeholder plan data. Showing invented measurements would undermine the one
 * thing NetPulse is for. Each page says what it will do, what it needs before it
 * can do it, and where to go in the meantime.
 */

type Upcoming = {
  title: string;
  icon: ComponentType<{ className?: string }>;
  status: "Coming later" | "Insufficient data";
  lede: string;
  what: string[];
  blocked: string[];
  meanwhile: { label: string; view: View }[];
};

const PAGES: Record<"areapulse" | "planreality" | "reports", Upcoming> = {
  areapulse: {
    title: "Area Pulse",
    icon: Radar,
    status: "Insufficient data",
    lede: "Regional awareness: whether the problem you're seeing is yours alone or shared by everyone on your segment tonight.",
    what: [
      "Compare your measured results against anonymised results from the same ISP and routing region.",
      "Show whether an evening slowdown is a neighbourhood-wide pattern or specific to your line.",
      "Flag ongoing incidents that correlate with a sudden change in your own numbers.",
    ],
    blocked: [
      "This needs aggregated measurements from many people on the same segment. NetPulse has no backend and collects nothing, so there is currently no data to aggregate.",
      "Building it means designing an opt-in, privacy-preserving contribution model first — publishing a fabricated outage map in the meantime would be worse than publishing nothing.",
    ],
    meanwhile: [
      { label: "Build your own baseline in History", view: "history" },
      { label: "Watch live with Connection Black Box", view: "blackbox" },
    ],
  },
  planreality: {
    title: "Plan Reality Check",
    icon: ScrollText,
    status: "Coming later",
    lede: "What you actually get, measured against what you actually pay for.",
    what: [
      "Record your advertised plan speeds once, then track measured results against them over time.",
      "Separate 'the line underperforms' from 'Wi-Fi underperforms' using wired and wireless runs.",
      "Produce a dated, exportable summary you can send to your ISP.",
    ],
    blocked: [
      "The measurement side already exists — what's missing is a considered way to capture plan details and a fair comparison window, so the verdict is defensible rather than a single unlucky test.",
      "Until that lands, NetPulse will not guess at your plan or grade you against an assumed tier.",
    ],
    meanwhile: [
      { label: "Compare runs over time in History", view: "history" },
      { label: "Check what speed you need", view: "calculator" },
    ],
  },
  reports: {
    title: "Saved Reports",
    icon: BookOpen,
    status: "Coming later",
    lede: "Keep full diagnostic reports — not just the headline numbers — and reopen them later.",
    what: [
      "Save a complete analysis, including raw samples and the confidence breakdown, under a name you choose.",
      "Reopen a saved report months later and compare it against a fresh run.",
      "Export a report as a single file to attach to a support ticket.",
    ],
    blocked: [
      "History currently keeps a compact summary of each run rather than the full sample set, so there is nothing complete to reopen yet.",
      "Storing full reports means deciding how much a browser should hold and how to prune it — that design comes before the feature, not after.",
    ],
    meanwhile: [
      { label: "Export the current analysis as JSON or CSV", view: "results" },
      { label: "Review saved summaries in History", view: "history" },
    ],
  },
};

export function UpcomingPage({
  page,
  onNavigate,
}: {
  page: keyof typeof PAGES;
  onNavigate: (v: View) => void;
}) {
  const p = PAGES[page];
  const Icon = p.icon;

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <PageHeader
        eyebrow="In development"
        title={p.title}
        description={p.lede}
        actions={<StatusPill tone="unknown">{p.status}</StatusPill>}
      />

      <Panel tone="quiet" className="flex items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground">
          <Icon className="size-5" />
        </span>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          This page is intentionally empty. NetPulse does not generate sample outages, example
          reports, mock plans or stand-in measurements to make an unfinished feature look finished —
          every number in this product is one your own connection produced.
        </p>
      </Panel>

      <Section title="What it will do">
        <ul className="space-y-2.5 text-[14px] leading-relaxed text-muted-foreground">
          {p.what.map((s) => (
            <li key={s} className="flex gap-3">
              <span className="mt-[9px] size-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="What it needs first">
        <div className="space-y-3 text-[14px] leading-relaxed text-muted-foreground">
          {p.blocked.map((s) => (
            <p key={s}>{s}</p>
          ))}
        </div>
      </Section>

      <Section title="In the meantime">
        <div className="flex flex-wrap gap-2.5">
          {p.meanwhile.map((m) => (
            <Button key={m.label} variant="outline" size="sm" onClick={() => onNavigate(m.view)}>
              {m.label}
            </Button>
          ))}
        </div>
      </Section>
    </div>
  );
}
