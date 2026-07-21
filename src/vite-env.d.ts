/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MONITOR_SECONDARY_URL?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  turnstile?: {
    render: (container: HTMLElement, options: { sitekey: string; action: string; theme: "auto" | "light" | "dark"; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }) => string;
    remove: (widgetId: string) => void;
    reset: (widgetId?: string) => void;
  };
}
