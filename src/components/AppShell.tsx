import {
  Activity,
  Archive,
  BookOpen,
  CircleHelp,
  Gauge,
  CodeXml,
  History,
  Info,
  Languages,
  Library,
  Monitor,
  Moon,
  Network,
  RadioTower,
  ReceiptText,
  Settings,
  ShieldCheck,
  Star,
  Sun,
  Wifi,
  WifiOff,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTheme } from "../hooks/use-theme";
import type { ThemePreference } from "../lib/theme";
import { ArcConnectionStatus } from "./ArcTelemetry";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "./ui/sidebar";
import { Switch } from "./ui/switch";

export type AppView = "speed" | "blackbox" | "history" | "connection";

type NavItem = {
  label: string;
  icon: LucideIcon;
  view?: AppView;
  planned?: string;
};

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Test",
    items: [
      { label: "Speed Test", icon: Gauge, view: "speed" },
      { label: "Fix My Internet", icon: Wrench, planned: "Guided diagnostics arrive in the next implementation phase." },
    ],
  },
  {
    label: "Monitor",
    items: [
      { label: "Connection Black Box", icon: Activity, view: "blackbox" },
      { label: "Area Pulse", icon: RadioTower, planned: "Regional evidence requires honest data sources before launch." },
    ],
  },
  {
    label: "Insights",
    items: [
      { label: "History", icon: History, view: "history" },
      { label: "Plan Reality Check", icon: ReceiptText, planned: "Plan comparison will be integrated with saved history." },
      { label: "Saved Reports", icon: Archive, planned: "Reports remain local until the workflow is implemented." },
    ],
  },
  {
    label: "Network",
    items: [
      { label: "Connection Details", icon: Network, view: "connection" },
      { label: "Privacy and DNS", icon: ShieldCheck, planned: "DNS diagnostics require measured resolver checks." },
    ],
  },
  {
    label: "Learn",
    items: [
      { label: "How Much Speed Do I Need?", icon: BookOpen, planned: "Evidence-based guidance is being prepared." },
      { label: "Guides", icon: Library, planned: "No placeholder guide pages are published." },
      { label: "FAQ", icon: CircleHelp, planned: "Documentation will follow the flagship workflows." },
    ],
  },
];

const VIEW_TITLES: Record<AppView, string> = {
  speed: "Speed Test",
  blackbox: "Connection Black Box",
  history: "History",
  connection: "Connection Details",
};

const SIDEBAR_KEY = "netpulse_sidebar";

export function AppShell({
  view,
  onViewChange,
  lowData,
  onLowDataChange,
  children,
}: {
  view: AppView;
  onViewChange: (view: AppView) => void;
  lowData: boolean;
  onLowDataChange: (enabled: boolean) => void;
  children: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const setOpen = (open: boolean) => {
    setSidebarOpen(open);
    try {
      localStorage.setItem(SIDEBAR_KEY, open ? "0" : "1");
    } catch {
      // The state remains available for this session.
    }
  };

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setOpen}>
      <ArcConnectionStatus className="arc-connection-status" />
      <Sidebar collapsible="icon" variant="sidebar" className="border-sidebar-border/80">
        <SidebarHeader className="px-3 py-4">
          <button className="brand-lockup" onClick={() => onViewChange("speed")} aria-label="Open Speed Test">
            <span className="brand-mark" aria-hidden="true">np</span>
            <span className="brand-copy">
              <span>net<span>pulse</span></span>
              <small>internet health console</small>
            </span>
          </button>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent>
          {NAV_GROUPS.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const active = item.view === view;
                    const title = item.planned ? `${item.label} — ${item.planned}` : item.label;
                    return (
                      <SidebarMenuItem key={item.label}>
                        <SidebarMenuButton
                          tooltip={title}
                          isActive={active}
                          disabled={!item.view}
                          aria-disabled={!item.view}
                          onClick={() => item.view && onViewChange(item.view)}
                          className="h-9"
                        >
                          <item.icon aria-hidden="true" />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                        {item.planned && <SidebarMenuBadge className="text-[9px]">NEXT</SidebarMenuBadge>}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarSeparator />
        <SidebarFooter className="p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SettingsSheet lowData={lowData} onLowDataChange={onLowDataChange} />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="About NetPulse" onClick={() => onViewChange("connection")}>
                <Info aria-hidden="true" />
                <span>About</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Open NetPulse on GitHub" asChild>
                <a href="https://github.com/bbarc0de/netpulse" target="_blank" rel="noreferrer">
                  <CodeXml aria-hidden="true" />
                  <span>GitHub</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0 bg-background">
        <header className="app-header">
          <div className="app-header__start">
            <SidebarTrigger aria-label="Toggle navigation" />
            <div>
              <p className="app-header__eyebrow">NetPulse diagnostics</p>
              <h1>{VIEW_TITLES[view]}</h1>
            </div>
          </div>
          <div className="app-header__actions">
            <Badge variant="outline" className={online ? "status-online" : "status-offline"}>
              {online ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
              {online ? "Online" : "Offline"}
            </Badge>
            <Button variant="outline" size="sm" asChild className="header-github">
              <a href="https://github.com/bbarc0de/netpulse" target="_blank" rel="noreferrer">
                <CodeXml aria-hidden="true" />
                GitHub
              </a>
            </Button>
            <Button size="sm" asChild className="header-star">
              <a href="https://github.com/bbarc0de/netpulse" target="_blank" rel="noreferrer">
                <Star aria-hidden="true" />
                Star
              </a>
            </Button>
            <LanguageSelect />
            <ThemeMenu />
            <SettingsSheet lowData={lowData} onLowDataChange={onLowDataChange} triggerOnly />
          </div>
        </header>
        <main id="main-content" className="app-content" tabIndex={-1}>
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Choose theme">
          <Icon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ThemeItem value="light" current={theme} onSelect={setTheme} icon={Sun} />
        <ThemeItem value="dark" current={theme} onSelect={setTheme} icon={Moon} />
        <ThemeItem value="system" current={theme} onSelect={setTheme} icon={Monitor} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeItem({
  value,
  current,
  onSelect,
  icon: Icon,
}: {
  value: ThemePreference;
  current: ThemePreference;
  onSelect: (theme: ThemePreference) => void;
  icon: LucideIcon;
}) {
  return (
    <DropdownMenuItem onSelect={() => onSelect(value)}>
      <Icon aria-hidden="true" />
      <span className="capitalize">{value}</span>
      {current === value && <span className="ml-auto text-primary">●</span>}
    </DropdownMenuItem>
  );
}

function LanguageSelect() {
  return (
    <Select value="en">
      <SelectTrigger className="language-select" aria-label="Language">
        <Languages aria-hidden="true" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="en">English</SelectItem>
      </SelectContent>
    </Select>
  );
}

function SettingsSheet({
  lowData,
  onLowDataChange,
  triggerOnly = false,
}: {
  lowData: boolean;
  onLowDataChange: (enabled: boolean) => void;
  triggerOnly?: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const trigger = triggerOnly ? (
    <Button variant="outline" size="icon" aria-label="Open settings">
      <Settings aria-hidden="true" />
    </Button>
  ) : (
    <SidebarMenuButton tooltip="Settings">
      <Settings aria-hidden="true" />
      <span>Settings</span>
    </SidebarMenuButton>
  );

  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>NetPulse settings</SheetTitle>
          <SheetDescription>Local preferences only. No account is required.</SheetDescription>
        </SheetHeader>
        <div className="settings-list">
          <label className="settings-row">
            <span>
              <strong>Low-data mode</strong>
              <small>Targets roughly 40 MB and trades sample depth for lower usage.</small>
            </span>
            <Switch checked={lowData} onCheckedChange={onLowDataChange} aria-label="Low-data mode" />
          </label>
          <div className="settings-row settings-row--stacked">
            <span>
              <strong>Theme</strong>
              <small>Stored only in this browser.</small>
            </span>
            <Select
              value={theme}
              onValueChange={(value) => {
                if (value === "light" || value === "dark" || value === "system") setTheme(value);
              }}
            >
              <SelectTrigger aria-label="Theme preference">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
