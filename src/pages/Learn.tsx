import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Clock, RotateCcw, Search, Star } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, KeyValueList, PageHeader, Panel, Section } from "@/components/np/Layout";
import { cn } from "@/lib/utils";

/* ============================== GUIDES ==================================== */
type Guide = {
  slug: string;
  title: string;
  summary: string;
  tag: string;
  mins: number;
  featured?: boolean;
  body: string[];
};

const GUIDES: Guide[] = [
  {
    slug: "download-speed",
    title: "Understanding download speed",
    summary: "What Mbps actually buys you, and where extra bandwidth stops helping.",
    tag: "Basics",
    mins: 3,
    featured: true,
    body: [
      "Download speed is how much data your connection can pull per second, measured in megabits per second (Mbps). 8 megabits = 1 megabyte, so a 100 Mbps line moves about 12.5 MB of data per second.",
      "Past roughly 100 Mbps, most everyday activities stop feeling faster — a web page is limited by latency and server response, not raw bandwidth. Big game downloads and 4K streams are the main things that keep scaling with more Mbps.",
      "Speed tests report a peak-ish figure: NetPulse uses the median of the top half of samples from a multi-connection run, which ignores TCP ramp-up without cherry-picking one lucky moment.",
    ],
  },
  {
    slug: "upload-speed",
    title: "Understanding upload speed",
    summary: "The number that quietly decides whether your calls and backups behave.",
    tag: "Basics",
    mins: 3,
    body: [
      "Upload is how fast you can send data out: video calls, livestreams, cloud backups, sending files. Cable and DSL plans are usually asymmetric — upload can be a tenth of download or less.",
      "Upload trouble is sneaky: when a backup or photo sync saturates the small upload queue, latency rises for everyone on the network, and the whole connection 'feels dead' even though download bandwidth is untouched.",
      "If calls stutter while backups run, look at upload-loaded latency in your NetPulse results — that's the number that captures this.",
    ],
  },
  {
    slug: "latency",
    title: "Ping and latency",
    summary: "Why a slower plan with low latency beats a fast one with high latency.",
    tag: "Responsiveness",
    mins: 4,
    featured: true,
    body: [
      "Latency is the round-trip time for a small message, in milliseconds. It's the floor for how responsive anything can feel — every click, keystroke, and game action pays it at minimum.",
      "Under about 20 ms is excellent; 20–50 ms is good; past 100 ms fast games and remote desktops feel laggy. Distance, medium (fiber vs DSL vs satellite), and VPNs set most of it.",
      "Bandwidth cannot buy back latency: a 2 Gbps plan with 150 ms latency feels worse for gaming than 50 Mbps at 15 ms.",
    ],
  },
  {
    slug: "jitter",
    title: "Jitter",
    summary: "Consistency matters more than the average — here's why.",
    tag: "Responsiveness",
    mins: 2,
    body: [
      "Jitter is how much latency wobbles between consecutive measurements. Real-time audio and games buffer against your worst recent latency, not your average — so consistency matters more than the number itself.",
      "Under 5 ms is rock steady; over 30 ms usually means Wi-Fi interference or congestion. If jitter is high on Wi-Fi, re-test next to the router or on Ethernet to isolate it.",
    ],
  },
  {
    slug: "packet-loss",
    title: "Packet loss",
    summary: "What it is, why browsers can't measure it properly, and what to use instead.",
    tag: "Responsiveness",
    mins: 3,
    body: [
      "Packet loss is data that never arrives and has to be sent again. A little loss is normal; sustained loss above about 1% causes stutter in calls and rubber-banding in games, because the retransmission always arrives too late to be useful.",
      "A browser cannot measure true packet loss. It has no access to ICMP or raw sockets, and TCP hides retransmissions from the page entirely — so any web speed test showing a precise 'packet loss %' is inferring it, not measuring it.",
      "NetPulse runs an experimental UDP-reachability check and labels it as experimental rather than dressing it up as a hard figure. For symptoms that look like loss, the honest browser-side evidence is jitter, latency spikes under load, and dropped probes in Connection Black Box.",
    ],
  },
  {
    slug: "bufferbloat",
    title: "Bufferbloat",
    summary: "The classic cause of 'fast speed test, laggy internet'.",
    tag: "Responsiveness",
    mins: 4,
    featured: true,
    body: [
      "Bufferbloat is latency that balloons the moment your line gets busy. Oversized router buffers queue packets instead of pacing them, so a single download can add hundreds of milliseconds for everyone.",
      "It's the classic 'fast speed test but laggy internet' cause: a 20-second max-speed test looks great while the connection becomes unusable under real load.",
      "The fix is queue management, not more bandwidth: routers with SQM (CAKE / fq_codel) or 'Smart Queue' hold latency nearly flat under full load. NetPulse grades bufferbloat A–F from the measured rise between idle and loaded latency, per direction.",
    ],
  },
  {
    slug: "wifi-vs-ethernet",
    title: "Wi-Fi vs Ethernet",
    summary: "The single cheapest upgrade, and the fastest way to split blame.",
    tag: "Home network",
    mins: 3,
    body: [
      "Ethernet is deterministic: no interference, no distance penalty, ~1 ms of added latency. Wi-Fi shares unlicensed airwaves with neighbors, microwaves, and walls.",
      "A cable is the single cheapest, most reliable upgrade for a desk you game or work at. When diagnosing any problem, one Ethernet test immediately splits 'Wi-Fi problem' from 'line problem'.",
      "That's exactly what NetPulse's Fix My Internet flow does with its before/after comparison.",
    ],
  },
  {
    slug: "router-placement",
    title: "Router placement",
    summary: "Wi-Fi is radio. Treat it like radio.",
    tag: "Home network",
    mins: 3,
    body: [
      "Wi-Fi is radio. Walls, floors, metal, and water (aquariums, radiators, people) absorb it; distance attenuates it.",
      "Put the router central and elevated, not in a cabinet, basement corner, or behind the TV. Every wall between you and the router costs signal — concrete and brick cost the most.",
      "If one distant room is always slow, a wired access point or mesh node placed *between* the router and that room beats maxing the router's transmit power.",
    ],
  },
  {
    slug: "frequency-bands",
    title: "2.4 GHz vs 5 GHz vs 6 GHz",
    summary: "Which band your device picked, and why it matters more than you think.",
    tag: "Home network",
    mins: 4,
    body: [
      "2.4 GHz travels farthest but is slow and crowded — three usable channels shared with neighbors, baby monitors, and microwaves. It's fine for smart-home gadgets.",
      "5 GHz is the workhorse: much faster, more channels, shorter reach. 6 GHz (Wi-Fi 6E/7) is fastest and cleanest but barely penetrates walls — same-room use.",
      "Slow phone in a far room? It probably fell back to congested 2.4 GHz. Naming bands separately (Home vs Home-5G) lets you see and choose.",
    ],
  },
  {
    slug: "night-congestion",
    title: "Why internet slows down at night",
    summary: "Shared infrastructure, peak hours, and how to prove it.",
    tag: "ISP",
    mins: 3,
    body: [
      "Residential internet is shared infrastructure. Your street's cable segment or fiber PON splits capacity among households, and 7–11 PM is when everyone streams.",
      "Congestion looks like: fine speeds at 2 PM, sagging throughput and rising latency every evening. That pattern — not one bad test — is the evidence.",
      "Test at different times and compare in NetPulse History. If evening results consistently crater, that's ISP congestion; a faster plan tier often shares the same congested segment.",
    ],
  },
  {
    slug: "tests-disagree",
    title: "Why speed tests disagree",
    summary: "Different servers, different math, different questions answered.",
    tag: "Testing",
    mins: 4,
    body: [
      "Different tests measure paths to different servers with different methods: server location, single vs multi connection, how the result is aggregated (peak vs median), test duration, and even browser vs app overhead.",
      "A CDN-hosted test (like NetPulse's Cloudflare endpoint) measures the path to the nearest edge — often the same path your streaming actually uses. An ISP-hosted Ookla server may sit inside your ISP's network and post higher numbers that skip the public internet entirely.",
      "None of them are 'wrong'; they answer different questions. NetPulse documents exactly what it measures in Methodology and never tunes results to match other platforms.",
    ],
  },
  {
    slug: "streaming",
    title: "Fixing streaming that buffers",
    summary: "Bitrate, sustained throughput, and why peak speed misleads.",
    tag: "Practical",
    mins: 3,
    body: [
      "A stream needs sustained throughput above its bitrate, not a high peak. Roughly: 5 Mbps for HD, 25 Mbps for 4K, per simultaneous stream. A connection that peaks at 300 Mbps but sags to 15 Mbps every evening will buffer 4K and still pass most speed tests.",
      "Buffering also comes from latency, not just bandwidth: players refill their buffer in bursts, and a spike at the wrong moment stalls playback even with headroom to spare.",
      "Check the stability figure and the evening-versus-daytime pattern in History rather than the single headline number. If throughput is fine but latency spikes under load, the cause is bufferbloat, not your plan.",
    ],
  },
  {
    slug: "video-calls",
    title: "Improving video calls",
    summary: "Choppy audio is almost never a download-speed problem.",
    tag: "Practical",
    mins: 3,
    body: [
      "Calls need modest bandwidth (2–4 Mbps) but steady latency and a clear upload path. Choppy audio is almost never a download-speed problem.",
      "Biggest wins: pause cloud backups and photo sync during calls (upload saturation is the #1 cause), prefer Ethernet or sit near the router, and fix bufferbloat with SQM if your grade is C or worse.",
      "NetPulse's upload-loaded latency number predicts call quality better than any headline speed.",
    ],
  },
  {
    slug: "gaming",
    title: "Improving gaming latency",
    summary: "What you can fix, and what no plan upgrade will ever buy.",
    tag: "Practical",
    mins: 3,
    body: [
      "Idle latency sets your floor (server distance, medium); you can't buy it down with bandwidth. What you *can* fix: Wi-Fi jitter (use Ethernet), bufferbloat (SQM/QoS), and background traffic (cap update downloads).",
      "Check NetPulse's 'Gaming while others download' rating — if it's poor while 'Competitive gaming' is fine, your router's queue is the problem, and SQM is the fix.",
    ],
  },
  {
    slug: "contact-isp",
    title: "When to contact your ISP",
    summary: "Build a case out of evidence instead of frustration.",
    tag: "ISP",
    mins: 3,
    body: [
      "Contact them with evidence, not vibes: multiple dated tests (NetPulse History), wired results (rules out your Wi-Fi), and a pattern — consistent shortfall vs the advertised plan, evening-only congestion, or repeated dropouts.",
      "Wired tests well below the plan rate at quiet hours are the strongest signal the problem is on their side. One bad test is noise; twenty tests with a pattern is a case.",
    ],
  },
];

export function GuidesPage() {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("All");
  const [open, setOpen] = useState<string | null>(null);

  const tags = ["All", ...Array.from(new Set(GUIDES.map((g) => g.tag)))];
  const shown = GUIDES.filter(
    (g) =>
      (tag === "All" || g.tag === tag) &&
      (q === "" || `${g.title} ${g.summary} ${g.body.join(" ")}`.toLowerCase().includes(q.toLowerCase())),
  );

  const article = open ? GUIDES.find((g) => g.slug === open) : null;

  /* ------------------------------ Article view ---------------------------- */
  if (article) {
    const related = GUIDES.filter((g) => g.tag === article.tag && g.slug !== article.slug).slice(0, 3);
    return (
      <article className="mx-auto max-w-2xl space-y-8">
        <Button variant="ghost" size="sm" className="-ml-2 gap-1.5" onClick={() => setOpen(null)}>
          <ArrowLeft className="size-3.5" /> All guides
        </Button>

        <header className="space-y-3">
          <p className="flex items-center gap-3 text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
            <span>{article.tag}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3" /> {article.mins} min read
            </span>
          </p>
          <h1 className="text-[30px] font-semibold leading-tight tracking-tight">{article.title}</h1>
          <p className="text-[15.5px] leading-relaxed text-muted-foreground">{article.summary}</p>
        </header>

        <div className="space-y-5 border-t border-border pt-8 text-[15px] leading-[1.75]">
          {article.body.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>

        {related.length > 0 && (
          <Section title="More in this topic" className="border-t border-border pt-8">
            <ul className="divide-y divide-border/70">
              {related.map((g) => (
                <li key={g.slug}>
                  <button
                    className="group flex w-full items-center justify-between gap-4 py-3 text-left"
                    onClick={() => setOpen(g.slug)}
                  >
                    <span className="min-w-0">
                      <span className="block text-[14.5px] font-medium">{g.title}</span>
                      <span className="block truncate text-[13px] text-muted-foreground">{g.summary}</span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </article>
    );
  }

  /* ------------------------------ Library view ---------------------------- */
  const featured = GUIDES.filter((g) => g.featured);
  const unfiltered = tag === "All" && q === "";

  return (
    <div className="space-y-10">
      <PageHeader
        title="Guides"
        description="Practical, no-nonsense explanations — written for humans, grounded in how networks actually behave."
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search guides…"
            className="h-9 pl-9"
            aria-label="Search guides"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <button
              key={t}
              onClick={() => setTag(t)}
              aria-pressed={t === tag}
              className={cn(
                "h-9 rounded-lg px-3 text-[13px] font-medium transition-colors",
                t === tag
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {unfiltered && (
        <Section title="Start here" description="The three that explain most connection complaints.">
          <div className="grid gap-4 md:grid-cols-3">
            {featured.map((g) => (
              <button
                key={g.slug}
                onClick={() => setOpen(g.slug)}
                className="group flex h-full flex-col items-start gap-2 rounded-xl border border-border bg-card p-5 text-left transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/40"
              >
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                  <Star className="size-3 fill-current" /> Featured
                </span>
                <span className="text-[15.5px] font-semibold leading-snug">{g.title}</span>
                <span className="text-[13px] leading-relaxed text-muted-foreground">{g.summary}</span>
                <span className="mt-auto inline-flex items-center gap-1.5 pt-3 text-[12px] text-muted-foreground">
                  <Clock className="size-3" /> {g.mins} min read
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {shown.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No guides match that search"
          description="Try a broader term, or clear the category filter."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setQ("");
                setTag("All");
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <Section title={unfiltered ? "All guides" : `${shown.length} guide${shown.length === 1 ? "" : "s"}`}>
          <ul className="divide-y divide-border/70 rounded-xl border border-border bg-card px-5">
            {shown.map((g) => (
              <li key={g.slug}>
                <button
                  className="group flex w-full items-center justify-between gap-6 py-4 text-left"
                  onClick={() => setOpen(g.slug)}
                >
                  <span className="min-w-0 space-y-1">
                    <span className="block text-[14.5px] font-medium">{g.title}</span>
                    <span className="block text-[13px] leading-relaxed text-muted-foreground">{g.summary}</span>
                    <span className="flex items-center gap-3 pt-0.5 text-[11.5px] uppercase tracking-[0.12em] text-muted-foreground">
                      <span>{g.tag}</span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3" /> {g.mins} min
                      </span>
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/* ================================ FAQ ===================================== */
const FAQS: { q: string; a: string; cat: string }[] = [
  { cat: "Speed", q: "Why is my Wi-Fi slow?", a: "Usually distance/walls to the router, congestion on 2.4 GHz, or neighbors on the same channel — not your plan. Test next to the router: if speed jumps, it's coverage. NetPulse's Fix My Internet walks this comparison and shows the evidence." },
  { cat: "Speed", q: "Why is upload slower than download?", a: "Most cable/DSL plans are built asymmetric because homes historically downloaded far more than they sent. Fiber plans are often symmetric. Check what your plan actually promises — measured upload near the promised figure means nothing is wrong." },
  { cat: "Speed", q: "Should I upgrade my plan?", a: "Only if measurements say the plan is the limit. If Ethernet tests hit your plan rate but Wi-Fi doesn't, upgrading buys nothing — the bottleneck is coverage. If latency under load is the complaint, bufferbloat is the cause and a faster plan won't fix it. NetPulse explicitly flags when an upgrade is unlikely to help." },
  { cat: "Latency", q: "What is a good ping?", a: "Under 20 ms is excellent, 20–50 ms good for everything, 50–100 ms noticeable in fast games, over 100 ms feels laggy for real-time use. NetPulse measures HTTPS round-trips, which read a few ms above raw ICMP ping." },
  { cat: "Latency", q: "What is jitter?", a: "Variation between consecutive latency measurements. Calls and games buffer against your worst recent latency, so high jitter causes robotic audio and rubber-banding even with a great average." },
  { cat: "Latency", q: "Why does gaming lag despite fast internet?", a: "Bandwidth and responsiveness are different things. The usual culprits: high base latency to the game server, Wi-Fi jitter, or bufferbloat when someone else uses the line. NetPulse's loaded-latency numbers expose the last two." },
  { cat: "Latency", q: "What is bufferbloat?", a: "Latency that balloons when your connection is busy, caused by oversized router buffers. It's the main reason connections 'feel slow despite fast speed tests'. Fix with SQM/Smart Queue on the router — not with a faster plan." },
  { cat: "Testing", q: "Why do different speed tests disagree?", a: "Different servers, paths, and math. Single vs multi connection, peak vs median reporting, server inside your ISP vs across the public internet. NetPulse documents its method and doesn't tune results to match anyone." },
  { cat: "Testing", q: "How often should I test?", a: "When something feels wrong, plus occasionally at different times of day to build a baseline. A handful of dated tests across a week (NetPulse History keeps them locally) is far stronger evidence than one test." },
  { cat: "Testing", q: "Why does streaming buffer?", a: "Either sustained throughput to the CDN dips below the stream bitrate (congestion), or latency spikes stall the stream's buffer refills. A 4K stream needs ~25 Mbps steady. Check stability and evening-vs-daytime history, not just peak speed." },
  { cat: "Testing", q: "Can a browser measure packet loss?", a: "Not properly. Browsers cannot send ICMP or raw packets, and TCP hides retransmissions from the page. NetPulse runs an experimental UDP-reachability check and labels it experimental rather than presenting a number it cannot stand behind." },
  { cat: "Network", q: "Does a VPN reduce speed?", a: "Usually yes — extra hops, encryption overhead, and the VPN server's own capacity. Effects range from negligible to severe. Test with it on and off (Fix My Internet automates the comparison) before blaming your ISP." },
  { cat: "Network", q: "Is Wi-Fi slower than Ethernet?", a: "Almost always. Ethernet adds ~1 ms and no interference; Wi-Fi shares airwaves and loses speed with distance and walls. Modern Wi-Fi can be plenty fast close to the router — the difference shows up in far rooms and busy environments." },
  { cat: "Network", q: "Should I upgrade my router?", a: "If it's 5+ years old, struggles with many devices, or lacks SQM/decent queue management, an upgrade helps responsiveness more than speed. If your NetPulse bufferbloat grade is D/F, prioritize a router with SQM (or OpenWrt) over a faster plan." },
  { cat: "Network", q: "Why is internet slower at night?", a: "Neighborhood congestion: residential lines share street-level capacity, and evenings are peak streaming hours. Consistent evening sag in your History with fine daytime numbers is the classic signature." },
  { cat: "Privacy", q: "Is NetPulse storing my IP address?", a: "No. NetPulse has no backend — results stay in your browser's local storage. Your IP is visible to the measurement endpoints you contact (as with any website), is masked by default in the UI, and is never included in exports or shared reports." },
  { cat: "Privacy", q: "Does NetPulse use analytics or trackers?", a: "No. There is no analytics script, no tracking pixel, and no account system. The only network requests are the measurement endpoints themselves, plus the optional ISP lookup you trigger by hand." },
];

export function FaqPage() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const cats = useMemo(() => ["All", ...Array.from(new Set(FAQS.map((f) => f.cat)))], []);

  const shown = FAQS.filter(
    (f) =>
      (cat === "All" || f.cat === cat) &&
      (q === "" || `${f.q} ${f.a}`.toLowerCase().includes(q.toLowerCase())),
  );
  const groups = cats.filter((c) => c !== "All" && shown.some((f) => f.cat === c));

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <PageHeader
        title="Frequently asked questions"
        description="Straight answers about speed, latency, and what actually fixes things."
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search questions…"
            className="h-9 pl-9"
            aria-label="Search FAQ"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              aria-pressed={c === cat}
              className={cn(
                "h-9 rounded-lg px-3 text-[13px] font-medium transition-colors",
                c === cat
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No questions match that search"
          description="Try a shorter phrase, or browse by category."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setQ("");
                setCat("All");
              }}
            >
              Clear search
            </Button>
          }
        />
      ) : (
        groups.map((group) => {
          const items = shown.filter((f) => f.cat === group);
          return (
            <Section key={group} title={group}>
              <Accordion type="multiple" className="rounded-xl border border-border bg-card px-5">
                {items.map((f, i) => (
                  <AccordionItem key={f.q} value={f.q} className={i === items.length - 1 ? "border-b-0" : ""}>
                    <AccordionTrigger className="text-left text-[14.5px] font-medium hover:no-underline">
                      {f.q}
                    </AccordionTrigger>
                    <AccordionContent className="text-[14px] leading-relaxed text-muted-foreground">
                      {f.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </Section>
          );
        })
      )}
    </div>
  );
}

/* ========================= SPEED CALCULATOR =============================== */
/**
 * Interactive, one-question-at-a-time speed-needs wizard.
 *
 * Recommendation logic is demand-based and documented: each answer adds a
 * published per-activity bitrate estimate (≈25 Mbps per 4K stream, 6 Mbps per
 * competitive game, 4–5 Mbps per HD call, etc.). We surface TWO tiers — a
 * "Good" plan that covers the concurrent worst hour with modest headroom, and
 * a "Best" plan with comfortable future-proof headroom. No marketing inflation;
 * a multi-gigabit tier is only recommended for genuinely gigabit-scale demand.
 */
type WAns = {
  people: number;
  streaming: number; // 0 none · 1 HD · 2 one-4K · 3 multi-4K
  gaming: number; // 0 no · 1 casual · 2 competitive
  calls: number; // simultaneous video calls
  smartHome: number; // 0 few · 1 some · 2 many
  remoteWork: boolean;
  creator: boolean;
  cloudBackup: boolean;
};

type Choice = { label: string; hint?: string; value: number | boolean };
type Question = { id: keyof WAns; title: string; subtitle: string; choices: Choice[] };

const QUESTIONS: Question[] = [
  {
    id: "people",
    title: "How many people are online at home?",
    subtitle: "Count everyone who might use the internet during a busy evening.",
    choices: [
      { label: "Just me", value: 1 },
      { label: "2 of us", value: 2 },
      { label: "3–4", value: 4 },
      { label: "5 or more", value: 6 },
    ],
  },
  {
    id: "streaming",
    title: "How much video streaming at once?",
    subtitle: "Netflix, YouTube, Disney+ at the same time, at peak.",
    choices: [
      { label: "None to speak of", value: 0 },
      { label: "One HD stream", hint: "~8 Mbps", value: 1 },
      { label: "One 4K stream", hint: "~25 Mbps", value: 2 },
      { label: "A house full of 4K screens", hint: "150 Mbps+", value: 3 },
    ],
  },
  {
    id: "gaming",
    title: "Is anyone gaming online?",
    subtitle: "Online multiplayer cares more about latency than raw speed.",
    choices: [
      { label: "No gaming", value: 0 },
      { label: "Casual / co-op", value: 1 },
      { label: "Competitive", hint: "low latency matters", value: 2 },
    ],
  },
  {
    id: "calls",
    title: "How many video calls run at the same time?",
    subtitle: "Zoom, Teams, FaceTime, Discord video.",
    choices: [
      { label: "None", value: 0 },
      { label: "One", value: 1 },
      { label: "Two", value: 2 },
      { label: "Three or more", value: 3 },
    ],
  },
  {
    id: "smartHome",
    title: "How many smart-home devices?",
    subtitle: "Cameras, speakers, thermostats, doorbells, TVs.",
    choices: [
      { label: "A few", value: 0 },
      { label: "Around 5–15", value: 1 },
      { label: "Lots (15+)", value: 2 },
    ],
  },
  {
    id: "remoteWork",
    title: "Does anyone work or study from home?",
    subtitle: "VPNs, screen-sharing, and cloud docs add sustained load.",
    choices: [
      { label: "No", value: false },
      { label: "Yes", value: true },
    ],
  },
  {
    id: "creator",
    title: "Any livestreaming or big uploads?",
    subtitle: "Streaming out, publishing video, or moving large files up.",
    choices: [
      { label: "No", value: false },
      { label: "Yes", value: true },
    ],
  },
  {
    id: "cloudBackup",
    title: "Do you run cloud backup?",
    subtitle: "Photo sync or full-PC backup uploading in the background.",
    choices: [
      { label: "No", value: false },
      { label: "Yes", value: true },
    ],
  },
];

const TIERS = [
  { max: 50, label: "Up to 50 Mbps" },
  { max: 100, label: "50–100 Mbps" },
  { max: 300, label: "100–300 Mbps" },
  { max: 500, label: "300–500 Mbps" },
  { max: 1000, label: "500 Mbps – 1 Gbps" },
  { max: 2000, label: "1–2 Gbps" },
  { max: Infinity, label: "2 Gbps+" },
];

type Rec = {
  goodTier: string;
  bestTier: string;
  goodDown: number;
  bestDown: number;
  up: number;
  latency: number;
  summary: string;
};

// Lower bound (Mbps) of each TIER, used to display the "Best" figure.
const TIER_FLOOR = [25, 50, 100, 300, 500, 1000, 2000];

function recommend(a: WAns): Rec {
  // Concurrent worst-hour demand from published per-activity bitrates. The top
  // streaming option models a big household running several 4K screens at once.
  const streamDemand = [0, 10, 25, 200][a.streaming];
  const gameDemand = [0, 6, 12][a.gaming];
  const callDemand = a.calls * 5;
  const peopleBase = a.people * 4;
  const smartDemand = [2, 8, 20][a.smartHome] * 0.5;
  const rawDown =
    streamDemand +
    gameDemand +
    callDemand +
    peopleBase +
    smartDemand +
    (a.creator ? 15 : 0) +
    (a.cloudBackup ? 12 : 0) +
    (a.remoteWork ? 10 : 0);

  const rawUp =
    a.calls * 4 + (a.creator ? 20 : 0) + (a.cloudBackup ? 15 : 0) + a.people * 2 + (a.remoteWork ? 8 : 0);

  const round = (n: number, step: number) => Math.max(step, Math.ceil(n / step) * step);

  // "Good" = concurrent demand + 80% headroom for bursts, overhead and updates.
  const goodDown = round(rawDown * 1.8, 10);
  const goodIdx = TIERS.findIndex((t) => goodDown <= t.max);
  // "Best" = one tier up — comfortable, future-proof headroom.
  const bestIdx = Math.min(goodIdx + 1, TIERS.length - 1);
  const bestDown = TIER_FLOOR[bestIdx];

  const up = round(rawUp * 1.3, 5);
  const latency = a.gaming === 2 ? 20 : a.gaming === 1 || a.calls > 0 || a.remoteWork ? 40 : 80;

  const summary =
    bestDown >= 1000
      ? "A heavy, gigabit-scale household — several 4K screens, uploads, gaming and devices at once. This is genuinely the top end."
      : rawDown < 40
        ? "A light setup — most of your speed will sit unused as headroom. Latency matters more than the big number here."
        : "A typical busy household — the Good tier covers your peak hour, the Best tier adds comfortable future-proofing.";

  return { goodTier: TIERS[goodIdx].label, bestTier: TIERS[bestIdx].label, goodDown, bestDown, up, latency, summary };
}

const DEFAULT_ANS: WAns = {
  people: 2,
  streaming: 1,
  gaming: 0,
  calls: 1,
  smartHome: 0,
  remoteWork: false,
  creator: false,
  cloudBackup: false,
};

/** Activities the recommendation is built to carry, restated from the answers. */
function supported(a: WAns): string[] {
  const out: string[] = [];
  out.push(`${a.people} ${a.people === 1 ? "person" : "people"} online at once`);
  if (a.streaming === 1) out.push("one HD video stream");
  if (a.streaming === 2) out.push("one 4K video stream");
  if (a.streaming === 3) out.push("several simultaneous 4K streams");
  if (a.gaming === 1) out.push("casual online gaming");
  if (a.gaming === 2) out.push("competitive gaming at low latency");
  if (a.calls > 0) out.push(`${a.calls} simultaneous video call${a.calls === 1 ? "" : "s"}`);
  if (a.remoteWork) out.push("remote work with VPN and screen sharing");
  if (a.creator) out.push("livestreaming or regular large uploads");
  if (a.cloudBackup) out.push("cloud backup running in the background");
  if (a.smartHome === 1) out.push("around 5–15 smart-home devices");
  if (a.smartHome === 2) out.push("15+ smart-home devices");
  out.push("everyday browsing for the whole household");
  return out;
}

export function CalculatorPage() {
  const [step, setStep] = useState(0);
  const [ans, setAns] = useState<WAns>(DEFAULT_ANS);
  const [done, setDone] = useState(false);

  const total = QUESTIONS.length;
  const q = QUESTIONS[step];

  const choose = (value: number | boolean) => {
    setAns((prev) => ({ ...prev, [q.id]: value }));
    if (step + 1 < total) setStep(step + 1);
    else setDone(true);
  };

  const restart = () => {
    setAns(DEFAULT_ANS);
    setStep(0);
    setDone(false);
  };

  const rec = recommend(ans);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader
        title="How Much Speed Do I Need?"
        description="Answer a few quick questions about your household's busiest hour. The recommendation uses published per-activity bitrates with sensible headroom — no marketing inflation."
      />

      {!done ? (
        <Panel className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {QUESTIONS.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors duration-300",
                    i < step ? "bg-primary" : i === step ? "bg-primary/50" : "bg-border",
                  )}
                />
              ))}
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Question {step + 1} of {total}
            </p>
          </div>

          <div key={step} className="space-y-5 duration-300 animate-in fade-in-0 slide-in-from-right-3">
            <div className="space-y-1.5">
              <h2 className="text-[19px] font-semibold tracking-tight">{q.title}</h2>
              <p className="text-[13.5px] leading-relaxed text-muted-foreground">{q.subtitle}</p>
            </div>

            <div className="grid gap-2.5">
              {q.choices.map((c) => {
                const selected = ans[q.id] === c.value;
                return (
                  <button
                    key={c.label}
                    onClick={() => choose(c.value)}
                    className={cn(
                      "group flex items-center justify-between gap-4 rounded-xl border px-4 py-3.5 text-left transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/60",
                      selected ? "border-primary/60 bg-primary/[0.08]" : "border-border",
                    )}
                  >
                    <span className="text-[14.5px] font-medium">{c.label}</span>
                    <span className="flex shrink-0 items-center gap-3">
                      {c.hint && <span className="font-mono text-[11px] text-muted-foreground">{c.hint}</span>}
                      <ArrowRight className="size-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
                    </span>
                  </button>
                );
              })}
            </div>

            {step > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep(step - 1)}
                className="-ml-2 gap-1.5 text-muted-foreground"
              >
                <ArrowLeft className="size-3.5" /> Back
              </Button>
            )}
          </div>
        </Panel>
      ) : (
        <div className="space-y-6 duration-300 animate-in fade-in-0">
          <p className="text-[14.5px] leading-relaxed text-muted-foreground">{rec.summary}</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Panel tone="accent" className="space-y-4">
              <div className="space-y-1.5">
                <Badge className="bg-primary/15 text-primary hover:bg-primary/15">Good</Badge>
                <p className="font-display text-[26px] font-bold leading-tight tracking-tight text-primary">
                  {rec.goodTier}
                </p>
                <p className="text-[12.5px] text-muted-foreground">Covers your peak hour.</p>
              </div>
              <KeyValueList
                items={[
                  { k: "Download", v: `≥ ${rec.goodDown} Mbps` },
                  { k: "Upload", v: `≥ ${rec.up} Mbps` },
                  { k: "Latency", v: `< ${rec.latency} ms` },
                ]}
              />
            </Panel>

            <Panel className="space-y-4">
              <div className="space-y-1.5">
                <Badge variant="outline">Best</Badge>
                <p className="font-display text-[26px] font-bold leading-tight tracking-tight">{rec.bestTier}</p>
                <p className="text-[12.5px] text-muted-foreground">Comfortable, future-proof headroom.</p>
              </div>
              <KeyValueList
                items={[
                  { k: "Download", v: `≥ ${rec.bestDown} Mbps` },
                  { k: "Upload", v: `≥ ${Math.round(rec.up * 1.6)} Mbps` },
                  { k: "Latency", v: `< ${rec.latency} ms` },
                ]}
              />
            </Panel>
          </div>

          <Section title="Activities this supports">
            <ul className="grid gap-1.5 text-[13.5px] text-muted-foreground sm:grid-cols-2">
              {supported(ans).map((s) => (
                <li key={s} className="flex gap-2">
                  <span className="mt-[8px] size-1 shrink-0 rounded-full bg-status-good" aria-hidden="true" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </Section>

          <div className="rounded-xl border-l-2 border-status-warn bg-status-warn/[0.07] px-4 py-3.5">
            <p className="text-[13px] leading-relaxed">
              <strong className="font-semibold">A faster plan does not fix weak Wi-Fi.</strong> If
              coverage is your real problem, the bottleneck sits between the router and your device,
              and no plan upgrade changes it. Run a NetPulse test next to the router and again in
              your usual spot before spending anything.
            </p>
          </div>

          <Button variant="outline" onClick={restart} className="gap-1.5">
            <RotateCcw className="size-3.5" /> Start over
          </Button>
        </div>
      )}
    </div>
  );
}
