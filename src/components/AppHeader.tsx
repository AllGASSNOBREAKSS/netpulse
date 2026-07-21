import { Star } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { GithubIcon, Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

export const REPO_URL = "https://github.com/bbarc0de/netpulse";

/**
 * The header's inner row uses the same `.np-container` as <main> and the
 * footer, so the three stay optically aligned at every width. The bar itself
 * still spans full width so its border reads as a real edge.
 */
export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 h-14 shrink-0 border-b border-border/80 bg-background/80 backdrop-blur-xl">
      <div className="np-container flex h-full items-center gap-3">
        <SidebarTrigger className="-ml-2 size-9 shrink-0" />
        <Separator orientation="vertical" className="!h-5 shrink-0" />

        {/* Compact brand: the full lockup + subtitle lives in the sidebar, so
            repeating the subtitle here would only invite clipping. */}
        <a
          href="/"
          className="flex min-w-0 items-center gap-2 rounded-md"
          aria-label="NetPulse home"
        >
          <Logo size={22} className="shrink-0" />
          <span className="font-wordmark truncate text-[17px] font-extrabold tracking-tight">
            net<span className="text-primary">pulse</span>
          </span>
        </a>

        <div className="flex flex-1 items-center justify-end gap-2">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-transparent px-3 text-[13px] font-medium text-foreground transition-[background-color,border-color,transform] duration-200 hover:border-foreground/25 hover:bg-accent active:scale-[0.98]"
          >
            <GithubIcon className="size-4 shrink-0" />
            <span className="hidden sm:inline">Star on GitHub</span>
            <Star className="size-3.5 shrink-0 text-muted-foreground transition-colors duration-200 group-hover:fill-status-warn group-hover:text-status-warn" />
          </a>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
