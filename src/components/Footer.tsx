import { Logo } from "./Logo";
import { REPO_URL } from "./AppHeader";
import type { View } from "@/lib/views";

type FooterLink = { label: string; view?: View; href?: string; onClickKey?: "methodology" };

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
      { label: "Methodology", onClickKey: "methodology" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "#/about" },
      { label: "GitHub", href: REPO_URL },
      { label: "Open Source", href: `${REPO_URL}/blob/main/LICENSE` },
      { label: "Contact", href: `${REPO_URL}/issues` },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", view: "privacy" },
      { label: "Terms", href: `${REPO_URL}/blob/main/LICENSE` },
      { label: "Accessibility", href: `${REPO_URL}/blob/main/AUDIT.md` },
      { label: "Security", href: `${REPO_URL}/security` },
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
  return (
    <footer role="contentinfo" className="mt-14 border-t bg-sidebar/40">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-10 sm:grid-cols-2 lg:grid-cols-5">
        <div className="max-w-xs space-y-3">
          <span className="flex items-center gap-2">
            <Logo size={24} />
            <span className="font-wordmark text-[17px] font-extrabold text-foreground">
              net<span className="text-primary">pulse</span>
            </span>
          </span>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            NetPulse helps people understand not only how fast their internet is, but how stable,
            responsive, and usable it is in real life.
          </p>
        </div>
        {COLS.map((col) => (
          <nav key={col.title} aria-label={col.title} className="space-y-2.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
              {col.title}
            </h3>
            <ul className="space-y-1.5">
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
                    <a
                      className={linkCls}
                      href={l.href}
                      target={l.href?.startsWith("#") ? "_blank" : "_blank"}
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
      <div className="border-t">
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
