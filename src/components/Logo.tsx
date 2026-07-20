/**
 * Original NetPulse mark: a rounded network node with a pulse waveform
 * passing through it — signal, heartbeat, and speed in one shape.
 * Legible at 16px; monochrome-safe; accent dot in electric blue.
 */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="NetPulse logo"
    >
      <rect x="2" y="2" width="28" height="28" rx="8" className="fill-foreground" />
      <path
        d="M7 16h4.2l2.3-6 3.6 12 2.4-6H27"
        stroke="var(--background)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="27" cy="16" r="2.6" className="fill-primary" />
    </svg>
  );
}

/** GitHub mark (lucide dropped brand icons). */
export function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** Wordmark lockup: logo + soft-black "netpulse" + optional subtitle. */
export function Wordmark({ subtitle }: { subtitle?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Logo size={28} className="shrink-0" />
      <span className="flex min-w-0 flex-col leading-none">
        <span className="font-wordmark text-[19px] font-extrabold tracking-tight text-foreground">
          net<span className="text-primary">pulse</span>
        </span>
        {subtitle && (
          <span className="mt-0.5 truncate text-[10.5px] font-medium tracking-wide text-muted-foreground">
            Understand your internet beyond speed.
          </span>
        )}
      </span>
    </span>
  );
}
