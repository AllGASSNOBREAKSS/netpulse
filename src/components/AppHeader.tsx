import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { GithubIcon, Wordmark } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

export const REPO_URL = "https://github.com/bbarc0de/netpulse";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-md sm:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 !h-5" />

      <div className="min-w-0 flex-1">
        <Wordmark subtitle />
      </div>

      <Button variant="outline" size="sm" className="group gap-1.5" asChild>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="Star NetPulse on GitHub">
          <GithubIcon className="size-4" />
          <span className="hidden lg:inline">Star on GitHub</span>
          <Star className="size-3.5 text-muted-foreground transition-all duration-200 group-hover:scale-110 group-hover:fill-status-warn group-hover:text-status-warn" />
        </a>
      </Button>

      <ThemeToggle />
    </header>
  );
}
