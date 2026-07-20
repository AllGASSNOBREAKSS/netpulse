import { GithubIcon, Logo, XIcon } from "./Logo";
import { REPO_URL } from "./AppHeader";
import type { View } from "@/lib/views";

const X_URL = "https://x.com/barcc0de";

type FooterLink = { label: string; view?: View; href?: string; onClickKey?: "methodology" };

// Product is deliberately short; Company carries more, mirroring the reference.
const COLS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Speed Test", view: "speed" },
      { label: "Complete Analysis", view: "results" },
      { label: "Fix My Internet", view: "fixit" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "#/about" },
      { label: "Guides", view: "guides" },
      { label: "FAQ", view: "faq" },
      { label: "Methodology", onClickKey: "methodology" },
      { label: "Privacy", view: "privacy" },
      { label: "Terms", href: `${REPO_URL}/blob/main/LICENSE` },
      { label: "License", href: `${REPO_URL}/blob/main/LICENSE` },
    ],
  },
];

export function NpFooter({
  onNavigate,
  onMethodology,
}: {
  onNavigate: (v: View) => void;
  onMethodology: () => void;
}) {
  const linkCls =
    "text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring rounded-sm";
  const iconBtn =
    "flex size-9 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

  return (
    <footer role="contentinfo" className="np-footer relative mt-14 overflow-hidden border-t bg-sidebar/40">
      <div className="np-footer__noise" aria-hidden="true" />

      <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-x-12 gap-y-8 px-5 py-12 sm:grid-cols-[1.4fr_0.8fr_1fr]">
        {/* Brand + socials */}
        <div className="space-y-4">
          <span className="flex items-center gap-2">
            <Logo size={24} />
            <span className="font-wordmark text-[17px] font-extrabold text-foreground">
              net<span className="text-primary">pulse</span>
            </span>
          </span>
          <p className="max-w-xs text-[13px] leading-relaxed text-muted-foreground">
            NetPulse helps people understand not only how fast their internet is, but how stable,
            responsive, and usable it is in real life.
          </p>
          <div className="flex items-center gap-2.5">
            <a href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="NetPulse on X" className={iconBtn}>
              <XIcon className="size-4" />
            </a>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="NetPulse on GitHub" className={iconBtn}>
              <GithubIcon className="size-4" />
            </a>
          </div>
        </div>

        {COLS.map((col) => (
          <nav key={col.title} aria-label={col.title} className="space-y-3">
            <h3 className="text-[13px] font-semibold text-foreground">{col.title}</h3>
            <ul className="space-y-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.view ? (
                    <button className={linkCls} onClick={() => onNavigate(l.view!)}>
                      {l.label}
                    </button>
                  ) : l.onClickKey ? (
                    <button className={linkCls} onClick={onMethodology}>
                      {l.label}
                    </button>
                  ) : (
                    <a className={linkCls} href={l.href} target="_blank" rel="noopener noreferrer">
                      {l.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="relative z-10 border-t">
        <div className="mx-auto w-full max-w-6xl space-y-1 px-5 py-5 text-[12.5px] text-muted-foreground">
          <p>© 2026 NetPulse and contributors. Open-source software licensed under AGPL-3.0.</p>
          <p className="text-muted-foreground/70">
            NetPulse is an independent project and is not affiliated with Ookla, Netflix, Speedtest,
            or FAST.com.
          </p>
        </div>
      </div>
    </footer>
  );
}
