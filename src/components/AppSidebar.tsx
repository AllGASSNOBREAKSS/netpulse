import {
  Activity,
  BookOpen,
  Calculator,
  Gauge as GaugeIcon,
  History,
  Info,
  LifeBuoy,
  ListChecks,
  Lock,
  MapPinned,
  Network,
  Radar,
  ScrollText,
  Wrench,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { GithubIcon, Logo } from "./Logo";
import { REPO_URL } from "./AppHeader";
import type { View } from "@/lib/views";

type Item = {
  view?: View;
  label: string;
  /** Longer form for the collapsed-rail tooltip when `label` is abbreviated. */
  tooltip?: string;
  icon: React.ComponentType<{ className?: string }>;
  soon?: boolean;
};

const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "Test",
    items: [
      { view: "speed", label: "Speed Test", icon: GaugeIcon },
      { view: "results", label: "Complete Analysis", icon: ListChecks },
      { view: "fixit", label: "Fix My Internet", icon: Wrench },
    ],
  },
  {
    label: "Monitor",
    items: [
      { view: "blackbox", label: "Connection Black Box", icon: Activity },
      { view: "areapulse", label: "Area Pulse", icon: Radar, soon: true },
    ],
  },
  {
    label: "Insights",
    items: [
      { view: "history", label: "History", icon: History },
      { view: "planreality", label: "Plan Reality Check", icon: ScrollText, soon: true },
      { view: "reports", label: "Saved Reports", icon: BookOpen, soon: true },
    ],
  },
  {
    label: "Network",
    items: [
      { view: "details", label: "Connection Details", icon: Network },
      { view: "privacy", label: "Connection & Privacy", icon: Lock },
    ],
  },
  {
    label: "Learn",
    items: [
      // Abbreviated so it can never overflow the rail; the page itself carries
      // the full question as its H1.
      { view: "calculator", label: "Speed Needs", tooltip: "How Much Speed Do I Need?", icon: Calculator },
      { view: "guides", label: "Guides", icon: MapPinned },
      { view: "faq", label: "FAQ", icon: LifeBuoy },
    ],
  },
];

export function AppSidebar({
  view,
  onNavigate,
  lowData,
  onLowData,
  testing,
}: {
  view: View;
  onNavigate: (v: View) => void;
  lowData: boolean;
  onLowData: (v: boolean) => void;
  testing: boolean;
}) {
  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="h-[4.5rem] justify-center border-b border-sidebar-border px-3.5 group-data-[collapsible=icon]:h-14 group-data-[collapsible=icon]:px-2">
        <a href="/" className="flex min-w-0 items-center gap-2.5 rounded-md" aria-label="NetPulse home">
          <Logo size={26} className="shrink-0" />
          <span className="flex min-w-0 flex-col leading-none group-data-[collapsible=icon]:hidden">
            <span className="font-wordmark text-[19px] font-extrabold tracking-tight text-sidebar-foreground">
              net<span className="text-primary">pulse</span>
            </span>
            <span className="mt-1 truncate text-[11px] font-medium text-muted-foreground">
              Understand your internet beyond speed.
            </span>
          </span>
        </a>
      </SidebarHeader>

      <SidebarContent className="gap-0 py-1">
        {GROUPS.map((g) => (
          <SidebarGroup key={g.label} className="py-1.5">
            <SidebarGroupLabel className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {g.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      tooltip={
                        item.soon
                          ? `${item.label} — in development`
                          : (item.tooltip ?? item.label)
                      }
                      isActive={item.view !== undefined && view === item.view}
                      onClick={() => item.view && onNavigate(item.view)}
                      className="h-9 text-[13.5px] transition-colors"
                    >
                      <item.icon />
                      <span className="truncate">{item.label}</span>
                    </SidebarMenuButton>
                    {item.soon && (
                      <SidebarMenuBadge className="text-[9px] font-semibold tracking-[0.12em] text-muted-foreground">
                        SOON
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center gap-2.5 px-1.5 py-1 group-data-[collapsible=icon]:hidden">
          <Switch id="lowdata" checked={lowData} onCheckedChange={onLowData} disabled={testing} />
          <Label htmlFor="lowdata" className="cursor-pointer text-[12.5px] text-muted-foreground">
            Low-data mode <span className="text-muted-foreground/60">(~40 MB)</span>
          </Label>
        </div>
        <SidebarSeparator className="group-data-[collapsible=icon]:hidden" />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="About NetPulse (new tab)" className="h-9 text-[13.5px]">
              <a href="#/about" target="_blank" rel="noopener noreferrer">
                <Info />
                <span>About</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="NetPulse on GitHub" className="h-9 text-[13.5px]">
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                <GithubIcon className="size-4" />
                <span>GitHub</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
