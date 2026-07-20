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
import { GithubIcon, Wordmark } from "./Logo";
import { REPO_URL } from "./AppHeader";
import type { View } from "@/lib/views";

type Item = { view?: View; label: string; icon: React.ComponentType<{ className?: string }>; soon?: boolean };

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
      { label: "Area Pulse", icon: Radar, soon: true },
    ],
  },
  {
    label: "Insights",
    items: [
      { view: "history", label: "History", icon: History },
      { label: "Plan Reality Check", icon: ScrollText, soon: true },
      { label: "Saved Reports", icon: BookOpen, soon: true },
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
      { view: "calculator", label: "How Much Speed Do I Need?", icon: Calculator },
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
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center border-b px-3 group-data-[collapsible=icon]:px-2">
        <Wordmark />
      </SidebarHeader>

      <SidebarContent>
        {GROUPS.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      tooltip={item.soon ? `${item.label} — in development` : item.label}
                      isActive={item.view !== undefined && view === item.view}
                      disabled={item.soon}
                      aria-disabled={item.soon}
                      onClick={() => item.view && onNavigate(item.view)}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                    {item.soon && <SidebarMenuBadge className="text-[9px] tracking-wider text-muted-foreground">SOON</SidebarMenuBadge>}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t">
        <div className="flex items-center gap-2 px-1 py-1 group-data-[collapsible=icon]:hidden">
          <Switch id="lowdata" checked={lowData} onCheckedChange={onLowData} disabled={testing} />
          <Label htmlFor="lowdata" className="cursor-pointer text-xs text-muted-foreground">
            Low-data mode <span className="text-muted-foreground/60">(~40 MB)</span>
          </Label>
        </div>
        <SidebarSeparator className="group-data-[collapsible=icon]:hidden" />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="About NetPulse (new tab)">
              <a href="#/about" target="_blank" rel="noopener noreferrer">
                <Info />
                <span>About</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="NetPulse on GitHub">
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
