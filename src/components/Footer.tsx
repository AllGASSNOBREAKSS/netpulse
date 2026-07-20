import { GithubIcon, Logo, XIcon } from "./Logo";
import { REPO_URL } from "./AppHeader";
import type { View } from "@/lib/views";

const X_URL = "https://x.com/barcc0de";

type FooterLink = { label: string; view?: View; href?: string; action?: "methodology" };

const COLS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Speed Test", view: "speed" },
      { label: "Complete Analysis", view: "results" },
      { label: "History", view: "history" },
      { label: "Connection Details", view: "details" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Guides", view: "guides" },
      { label: "FAQ", view: "faq" },
      { label: "How Much Speed Do I Need?", view: "calculator" },
      { label: "Methodology", action: "methodology" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "#/about" },
      { label: "GitHub", href: REPO_URL },
      { label: "Open Source", href: `${REPO_URL}#readme` },
      { label: "Contact", href: `${REPO_URL}/issues` },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", view: "privacy" },
      { label: "Terms", href: `${REPO_URL}/blob/main/LICENSE` },
      { label: "Accessibility", href: "#/about" },
      { label: "Security", href: `${REPO_URL}/security` },
      { label: "License", href: `${REPO_URL}/blob/main/LICENSE` },
    ],
  },
];

/**
 * Uses the same `.np-container` as the header and <main>, so the footer's
 * content edge lines up with the page above it instead of drifting.
 */
export function NpFooter({
  onNavigate,
  onMethodology,
}: {
  onNavigate: (v: View) => void;
  onMethodology: () => void;
}) {
  const linkCls =
    "rounded-sm text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground";
  const iconBtn =
    "flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground";

  return (
    <footer role="contentinfo" className="relative z-10 mt-16 border-t border-border bg-sidebar/50">
      <div className="np-container grid gap-x-10 gap-y-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.5fr_repeat(4,minmax(0,1fr))]">
        {/* Brand + socials */}
        <div className="space-y-4">
          <span className="flex items-center gap-2.5">
            <Logo size={24} />
            <span className="font-wordmark text-[17px] font-extrabold tracking-tight text-foreground">
              net<span className="text-primary">pulse</span>
            </span>
          </span>
          <p className="max-w-xs text-[13px] leading-relaxed text-muted-foreground">
            Understand not only how fast your internet is, but how stable, responsive and usable it
            is in real life.
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
          <nav key={col.title} aria-label={col.title} className="space-y-3.5">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-foreground">
              {col.title}
            </h3>
            <ul className="space-y-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.view ? (
                    <button className={linkCls} onClick={() => onNavigate(l.view!)}>
                      {l.label}
                    </button>
                  ) : l.action ? (
                    <button className={linkCls} onClick={onMethodology}>
                      {l.label}
                    </button>
                  ) : (
                    <a
                      className={linkCls}
                      href={l.href}
                      target={l.href?.startsWith("#") ? undefined : "_blank"}
                      rel="noopener noreferrer"
                    >
                      {l.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-border/70">
        <div className="np-container space-y-1 py-5 text-[12.5px] leading-relaxed text-muted-foreground">
          <p>© 2026 NetPulse and contributors. Open-source software licensed under AGPL-3.0.</p>
          <p className="text-muted-foreground/75">
            NetPulse is an independent project and is not affiliated with Ookla, Netflix, Speedtest,
            or FAST.com.
          </p>
        </div>
      </div>
    </footer>
  );
}
