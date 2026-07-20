import { useMemo, useState } from "react";
import { Clock, Search } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/* ============================== GUIDES ==================================== */
type Guide = { title: string; tag: string; mins: number; body: string[] };

const GUIDES: Guide[] = [
  {
    title: "Understanding download speed",
    tag: "Basics",
    mins: 3,
    body: [
      "Download speed is how much data your connection can pull per second, measured in megabits per second (Mbps). 8 megabits = 1 megabyte, so a 100 Mbps line moves about 12.5 MB of data per second.",
      "Past roughly 100 Mbps, most everyday activities stop feeling faster — a web page is limited by latency and server response, not raw bandwidth. Big game downloads and 4K streams are the main things that keep scaling with more Mbps.",
      "Speed tests report a peak-ish figure: NetPulse uses the median of the top half of samples from a multi-connection run, which ignores TCP ramp-up without cherry-picking one lucky moment.",
    ],
  },
  {
    title: "Understanding upload speed",
    tag: "Basics",
    mins: 3,
    body: [
      "Upload is how fast you can send data out: video calls, livestreams, cloud backups, sending files. Cable and DSL plans are usually asymmetric — upload can be a tenth of download or less.",
      "Upload trouble is sneaky: when a backup or photo sync saturates the small upload queue, latency rises for everyone on the network, and the whole connection 'feels dead' even though download bandwidth is untouched.",
      "If calls stutter while backups run, look at upload-loaded latency in your NetPulse results — that's the number that captures this.",
    ],
  },
  {
    title: "Ping and latency",
    tag: "Responsiveness",
    mins: 4,
    body: [
      "Latency is the round-trip time for a small message, in milliseconds. It's the floor for how responsive anything can feel — every click, keystroke, and game action pays it at minimum.",
      "Under about 20 ms is excellent; 20–50 ms is good; past 100 ms fast games and remote desktops feel laggy. Distance, medium (fiber vs DSL vs satellite), and VPNs set most of it.",
      "Bandwidth cannot buy back latency: a 2 Gbps plan with 150 ms latency feels worse for gaming than 50 Mbps at 15 ms.",
    ],
  },
  {
    title: "Jitter",
    tag: "Responsiveness",
    mins: 2,
    body: [
      "Jitter is how much latency wobbles between consecutive measurements. Real-time audio and games buffer against your worst recent latency, not your average — so consistency matters more than the number itself.",
      "Under 5 ms is rock steady; over 30 ms usually means Wi-Fi interference or congestion. If jitter is high on Wi-Fi, re-test next to the router or on Ethernet to isolate it.",
    ],
  },
  {
    title: "Bufferbloat",
    tag: "Responsiveness",
    mins: 4,
    body: [
      "Bufferbloat is latency that balloons the moment your line gets busy. Oversized router buffers queue packets instead of pacing them, so a single download can add hundreds of milliseconds for everyone.",
      "It's the classic 'fast speed test but laggy internet' cause: a 20-second max-speed test looks great while the connection becomes unusable under real load.",
      "The fix is queue management, not more bandwidth: routers with SQM (CAKE / fq_codel) or 'Smart Queue' hold latency nearly flat under full load. NetPulse grades bufferbloat A–F from the measured rise between idle and loaded latency, per direction.",
    ],
  },
  {
    title: "Wi-Fi vs Ethernet",
    tag: "Home network",
    mins: 3,
    body: [
      "Ethernet is deterministic: no interference, no distance penalty, ~1 ms of added latency. Wi-Fi shares unlicensed airwaves with neighbors, microwaves, and walls.",
      "A cable is the single cheapest, most reliable upgrade for a desk you game or work at. When diagnosing any problem, one Ethernet test immediately splits 'Wi-Fi problem' from 'line problem'.",
      "That's exactly what NetPulse's Fix My Internet flow does with its before/after comparison.",
    ],
  },
  {
    title: "Router placement",
    tag: "Home network",
    mins: 3,
    body: [
      "Wi-Fi is radio. Walls, floors, metal, and water (aquariums, radiators, people) absorb it; distance attenuates it.",
      "Put the router central and elevated, not in a cabinet, basement corner, or behind the TV. Every wall between you and the router costs signal — concrete and brick cost the most.",
      "If one distant room is always slow, a wired access point or mesh node placed *between* the router and that room beats maxing the router's transmit power.",
    ],
  },
  {
    title: "2.4 GHz vs 5 GHz vs 6 GHz",
    tag: "Home network",
    mins: 4,
    body: [
      "2.4 GHz travels farthest but is slow and crowded — three usable channels shared with neighbors, baby monitors, and microwaves. It's fine for smart-home gadgets.",
      "5 GHz is the workhorse: much faster, more channels, shorter reach. 6 GHz (Wi-Fi 6E/7) is fastest and cleanest but barely penetrates walls — same-room use.",
      "Slow phone in a far room? It probably fell back to congested 2.4 GHz. Naming bands separately (Home vs Home-5G) lets you see and choose.",
    ],
  },
  {
    title: "Why internet slows down at night",
    tag: "ISP",
    mins: 3,
    body: [
      "Residential internet is shared infrastructure. Your street's cable segment or fiber PON splits capacity among households, and 7–11 PM is when everyone streams.",
      "Congestion looks like: fine speeds at 2 PM, sagging throughput and rising latency every evening. That pattern — not one bad test — is the evidence.",
      "Test at different times and compare in NetPulse History. If evening results consistently crater, that's ISP congestion; a faster plan tier often shares the same congested segment.",
    ],
  },
  {
    title: "Why speed tests disagree",
    tag: "Testing",
    mins: 4,
    body: [
      "Different tests measure paths to different servers with different methods: server location, single vs multi connection, how the result is aggregated (peak vs median), test duration, and even browser vs app overhead.",
      "A CDN-hosted test (like NetPulse's Cloudflare endpoint) measures the path to the nearest edge — often the same path your streaming actually uses. An ISP-hosted Ookla server may sit inside your ISP's network and post higher numbers that skip the public internet entirely.",
      "None of them are 'wrong'; they answer different questions. NetPulse documents exactly what it measures in Methodology and never tunes results to match other platforms.",
    ],
  },
  {
    title: "Improving video calls",
    tag: "Practical",
    mins: 3,
    body: [
      "Calls need modest bandwidth (2–4 Mbps) but steady latency and a clear upload path. Choppy audio is almost never a download-speed problem.",
      "Biggest wins: pause cloud backups and photo sync during calls (upload saturation is the #1 cause), prefer Ethernet or sit near the router, and fix bufferbloat with SQM if your grade is C or worse.",
      "NetPulse's upload-loaded latency number predicts call quality better than any headline speed.",
    ],
  },
  {
    title: "Improving gaming latency",
    tag: "Practical",
    mins: 3,
    body: [
      "Idle latency sets your floor (server distance, medium); you can't buy it down with bandwidth. What you *can* fix: Wi-Fi jitter (use Ethernet), bufferbloat (SQM/QoS), and background traffic (cap update downloads).",
      "Check NetPulse's 'Gaming while others download' rating — if it's poor while 'Competitive gaming' is fine, your router's queue is the problem, and SQM is the fix.",
    ],
  },
  {
    title: "When to contact your ISP",
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
  const tags = ["All", ...Array.from(new Set(GUIDES.map((g) => g.tag)))];
  const shown = GUIDES.filter(
    (g) =>
      (tag === "All" || g.tag === tag) &&
      (q === "" || g.title.toLowerCase().includes(q.toLowerCase()) || g.body.join(" ").toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-extrabold italic">Guides</h1>
        <p className="text-sm text-muted-foreground">
          Practical, no-nonsense explanations — written for humans, grounded in how networks actually behave.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search guides…" className="w-56 pl-8" aria-label="Search guides" />
        </div>
        {tags.map((t) => (
          <Button key={t} size="sm" variant={t === tag ? "secondary" : "ghost"} onClick={() => setTag(t)}>
            {t}
          </Button>
        ))}
      </div>
      {shown.length === 0 && <p className="text-sm text-muted-foreground">No guides match that search.</p>}
      <Accordion type="multiple" className="grid gap-3 lg:grid-cols-2">
        {shown.map((g) => (
          <Card key={g.title} className="h-fit py-2">
            <AccordionItem value={g.title} className="border-0 px-4">
              <AccordionTrigger className="py-3 hover:no-underline">
                <span className="flex flex-col items-start gap-1 text-left">
                  <span className="text-[15px] font-semibold">{g.title}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="text-[10px]">{g.tag}</Badge>
                    <Clock className="size-3" /> {g.mins} min read
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="space-y-2.5 text-[13.5px] leading-relaxed text-muted-foreground">
                {g.body.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </AccordionContent>
            </AccordionItem>
          </Card>
        ))}
      </Accordion>
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
  { cat: "Network", q: "Does a VPN reduce speed?", a: "Usually yes — extra hops, encryption overhead, and the VPN server's own capacity. Effects range from negligible to severe. Test with it on and off (Fix My Internet automates the comparison) before blaming your ISP." },
  { cat: "Network", q: "Is Wi-Fi slower than Ethernet?", a: "Almost always. Ethernet adds ~1 ms and no interference; Wi-Fi shares airwaves and loses speed with distance and walls. Modern Wi-Fi can be plenty fast close to the router — the difference shows up in far rooms and busy environments." },
  { cat: "Network", q: "Should I upgrade my router?", a: "If it's 5+ years old, struggles with many devices, or lacks SQM/decent queue management, an upgrade helps responsiveness more than speed. If your NetPulse bufferbloat grade is D/F, prioritize a router with SQM (or OpenWrt) over a faster plan." },
  { cat: "Network", q: "Why is internet slower at night?", a: "Neighborhood congestion: residential lines share street-level capacity, and evenings are peak streaming hours. Consistent evening sag in your History with fine daytime numbers is the classic signature." },
  { cat: "Privacy", q: "Is NetPulse storing my IP address?", a: "No. NetPulse has no backend — results stay in your browser's local storage. Your IP is visible to the measurement endpoints you contact (as with any website), is masked by default in the UI, and is never included in exports or shared reports." },
];

export function FaqPage() {
  const [q, setQ] = useState("");
  const cats = useMemo(() => Array.from(new Set(FAQS.map((f) => f.cat))), []);
  const match = (f: (typeof FAQS)[number]) =>
    q === "" || f.q.toLowerCase().includes(q.toLowerCase()) || f.a.toLowerCase().includes(q.toLowerCase());

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-extrabold italic">FAQ</h1>
        <p className="text-sm text-muted-foreground">Straight answers about speed, latency, and what actually fixes things.</p>
      </div>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search questions…" className="pl-8" aria-label="Search FAQ" />
      </div>
      {cats.map((cat) => {
        const items = FAQS.filter((f) => f.cat === cat && match(f));
        if (!items.length) return null;
        return (
          <section key={cat}>
            <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{cat}</h2>
            <Accordion type="multiple">
              {items.map((f) => (
                <AccordionItem key={f.q} value={f.q}>
                  <AccordionTrigger className="text-left text-sm font-medium">{f.q}</AccordionTrigger>
                  <AccordionContent className="text-[13.5px] leading-relaxed text-muted-foreground">{f.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        );
      })}
    </div>
  );
}

/* ========================= SPEED CALCULATOR =============================== */
/**
 * Recommendation logic — documented, conservative, and derived from published
 * per-activity bitrates (e.g. ~25 Mbps per 4K stream, 2–4 Mbps per HD call).
 * No marketing inflation: 1 Gbps is recommended only for genuinely heavy
 * concurrent households.
 */
type Answers = {
  people: number;
  streams4k: number;
  streamsHd: number;
  gamers: number;
  calls: number;
  remoteWork: boolean;
  creator: boolean;
  cloudBackup: boolean;
  smartHome: number;
};

const DEFAULTS: Answers = {
  people: 2,
  streams4k: 1,
  streamsHd: 1,
  gamers: 0,
  calls: 1,
  remoteWork: false,
  creator: false,
  cloudBackup: false,
  smartHome: 5,
};

function recommend(a: Answers) {
  // Download: sum of concurrent demand + 40% headroom for bursts/updates.
  const down =
    (a.streams4k * 25 + a.streamsHd * 8 + a.gamers * 3 + a.calls * 4 + a.people * 3 + a.smartHome * 0.3) * 1.4;
  // Upload: calls dominate; creators and backups add sustained demand.
  const up = (a.calls * 4 + (a.creator ? 12 : 0) + (a.cloudBackup ? 10 : 0) + a.people * 1) * 1.3;
  const latency = a.gamers > 0 ? 30 : a.calls > 0 || a.remoteWork ? 50 : 100;

  const tier =
    down <= 100 ? "Up to 100 Mbps" : down <= 300 ? "100–300 Mbps" : down <= 500 ? "300–500 Mbps" : down <= 1000 ? "500–1000 Mbps" : "1 Gbps+";

  return { down: Math.ceil(down / 10) * 10, up: Math.ceil(up / 5) * 5, latency, tier };
}

const TIER_NOTES: Record<string, string> = {
  "Up to 100 Mbps": "Comfortable for small households: streaming, browsing, calls, and casual gaming all fit with room to spare.",
  "100–300 Mbps": "The sweet spot for most families — several simultaneous streams, gaming, and calls without contention.",
  "300–500 Mbps": "Heavy concurrent use: multiple 4K streams plus gaming plus large downloads at once.",
  "500–1000 Mbps": "Big busy households and frequent huge downloads. Diminishing returns for most people start here.",
  "1 Gbps+": "Rarely required. Useful for creator workflows moving very large files daily — otherwise mostly headroom.",
};

export function CalculatorPage() {
  const [a, setA] = useState<Answers>(DEFAULTS);
  const r = recommend(a);
  const set = <K extends keyof Answers>(k: K, v: Answers[K]) => setA((prev) => ({ ...prev, [k]: v }));

  const numField = (k: keyof Answers, label: string, max: number) => (
    <div className="space-y-1.5">
      <Label htmlFor={String(k)}>{label}</Label>
      <Select value={String(a[k])} onValueChange={(v) => set(k, Number(v) as never)}>
        <SelectTrigger id={String(k)} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: max + 1 }, (_, i) => (
            <SelectItem key={i} value={String(i)}>
              {i}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const boolField = (k: keyof Answers, label: string, desc: string) => (
    <button
      className={`rounded-lg border p-3 text-left transition-colors ${a[k] ? "border-primary bg-primary/10" : "hover:bg-accent"}`}
      onClick={() => set(k, !a[k] as never)}
      aria-pressed={Boolean(a[k])}
    >
      <div className="text-sm font-medium">{label}</div>
      <div className="text-xs text-muted-foreground">{desc}</div>
    </button>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-extrabold italic">How Much Speed Do I Need?</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Answer honestly for a *concurrent worst hour*, not the whole day. The recommendation uses
          published per-activity bitrates plus 40% headroom — no marketing inflation.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your household, at its busiest</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {numField("people", "People at home", 8)}
              {numField("streams4k", "Simultaneous 4K streams", 5)}
              {numField("streamsHd", "Simultaneous HD streams", 6)}
              {numField("gamers", "People gaming online", 5)}
              {numField("calls", "Simultaneous video calls", 5)}
              {numField("smartHome", "Smart-home devices", 30)}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {boolField("remoteWork", "Remote work", "VPN, screen shares, cloud docs")}
              {boolField("creator", "Creator / livestreaming", "Uploading video, streaming out")}
              {boolField("cloudBackup", "Cloud backup", "Photos or PC backup running")}
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit lg:col-span-2">
          <CardHeader className="pb-2">
            <CardDescription>Recommended plan</CardDescription>
            <CardTitle className="font-display text-3xl font-extrabold italic text-primary">{r.tier}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border p-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Download</div>
                <div className="font-mono font-bold">≥{r.down} Mbps</div>
              </div>
              <div className="rounded-lg border p-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Upload</div>
                <div className="font-mono font-bold">≥{r.up} Mbps</div>
              </div>
              <div className="rounded-lg border p-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Latency</div>
                <div className="font-mono font-bold">&lt;{r.latency} ms</div>
              </div>
            </div>
            <p className="text-muted-foreground">{TIER_NOTES[r.tier]}</p>
            <p className="rounded-lg border border-status-warn/40 bg-status-warn/10 p-2.5 text-[13px]">
              <strong>Before upgrading:</strong> if Wi-Fi coverage is your real problem, a faster
              plan changes nothing — the bottleneck is between the router and your device. Run a
              NetPulse test next to the router vs. your usual spot first.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
