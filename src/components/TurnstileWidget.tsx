import { useEffect, useRef, useState } from "react";

const SCRIPT_ID = "netpulse-turnstile-script";
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export function TurnstileWidget({ siteKey, action = "area-pulse-report", onToken }: { siteKey: string; action?: "area-pulse-report" | "area-pulse-abuse"; onToken: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState("Loading anti-abuse verification…");

  useEffect(() => {
    let canceled = false;
    const render = () => {
      if (canceled || !containerRef.current || !window.turnstile || widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        theme: "auto",
        callback: (token) => { onToken(token); setStatus("Anti-abuse verification complete."); },
        "expired-callback": () => { onToken(""); setStatus("Verification expired. Complete it again."); },
        "error-callback": () => { onToken(""); setStatus("Verification could not load."); },
      });
    };
    if (window.turnstile) render();
    else {
      let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement("script");
        script.id = SCRIPT_ID;
        script.src = SCRIPT_URL;
        script.async = true;
        script.defer = true;
        document.head.append(script);
      }
      script.addEventListener("load", render, { once: true });
    }
    return () => {
      canceled = true;
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [action, onToken, siteKey]);

  return <div className="turnstile-wrap"><div ref={containerRef} /><p role="status">{status}</p></div>;
}
