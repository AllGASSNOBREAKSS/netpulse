/**
 * NetPulse page primitives.
 *
 * These exist so pages stop hand-rolling their own headings, stat grids and
 * key/value rows. Grouping is done with spacing, type scale and hairline
 * separators — a border is only drawn when a surface is genuinely elevated
 * above the workspace, never around every metric or paragraph.
 *
 * One owner per pattern:
 *   PageHeader   every page title block
 *   Section      a titled region inside a page (borderless by default)
 *   Panel        an elevated surface (the only thing that draws a border)
 *   StatGrid     compact measured figures, separated by hairlines
 *   KeyValue     borderless definition rows
 *   EmptyState   "nothing here yet" / "not implemented" states
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ------------------------------- PageHeader ------------------------------ */

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: string;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="min-w-0 max-w-2xl space-y-1.5">
        {eyebrow && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-[30px]">
          {title}
        </h1>
        {description && (
          <p className="text-[14.5px] leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* -------------------------------- Section -------------------------------- */

export function Section({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("min-w-0 space-y-4", className)}>
      {(title || actions) && (
        <div className="min-w-0 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="min-w-0 space-y-1">
            {title && <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>}
            {description && (
              <p className="max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/* --------------------------------- Panel --------------------------------- */

/**
 * The one elevated surface. `tone="quiet"` drops the border for regions that
 * only need a slightly lifted background (charts, tables).
 */
export function Panel({
  children,
  className,
  tone = "default",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  tone?: "default" | "quiet" | "accent";
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl",
        padded && "p-5 sm:p-6",
        tone === "default" && "border border-border bg-card",
        tone === "quiet" && "bg-muted/40",
        tone === "accent" && "border border-primary/30 bg-primary/[0.06]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------- StatGrid ------------------------------- */

export type Stat = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
  mono?: boolean;
  /** Makes the cell a button (used for "explain this metric" drill-downs). */
  onClick?: () => void;
  badge?: string;
};

const TONE_TEXT = {
  default: "",
  good: "text-status-good",
  warn: "text-status-warn",
  bad: "text-status-bad",
} as const;

/**
 * Measured figures laid out on a hairline grid. No card per number — the grid
 * lines do the grouping, which is what keeps a dense readout readable.
 */
export function StatGrid({
  stats,
  columns = 4,
  size = "md",
  className,
}: {
  stats: Stat[];
  columns?: 2 | 3 | 4;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const cols = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
  }[columns];

  // A <dl> may only contain dt/dd/div, so a grid with drill-down cells uses
  // plain elements instead of definition-list semantics.
  const interactive = stats.some((s) => s.onClick);
  const Wrapper = interactive ? "div" : "dl";
  const Term = interactive ? "span" : "dt";
  const Desc = interactive ? "span" : "dd";

  return (
    <Wrapper
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border",
        cols,
        className,
      )}
    >
      {stats.map((s) => {
        const body = (
          <>
            <Term className="flex items-center gap-1.5 truncate text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <span className="truncate">{s.label}</span>
              {s.badge && (
                <span className="shrink-0 rounded border border-status-warn/40 px-1 text-[8px] tracking-[0.1em] text-status-warn">
                  {s.badge}
                </span>
              )}
            </Term>
            <Desc
              className={cn(
                "mt-1 block truncate font-semibold tabular-nums",
                s.mono !== false && "font-mono",
                size === "sm" && "text-[14px]",
                size === "md" && "text-[17px]",
                size === "lg" && "text-[22px]",
                TONE_TEXT[s.tone ?? "default"],
              )}
            >
              {s.value}
            </Desc>
            {s.hint && (
              <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">{s.hint}</span>
            )}
          </>
        );

        const cell = "block bg-card px-4 py-3.5 text-left sm:px-5";
        return s.onClick ? (
          <button
            key={s.label}
            type="button"
            onClick={s.onClick}
            className={cn(cell, "transition-colors duration-200 hover:bg-accent")}
          >
            {body}
          </button>
        ) : (
          <div key={s.label} className={cell}>
            {body}
          </div>
        );
      })}
    </Wrapper>
  );
}

/* -------------------------------- KeyValue ------------------------------- */

export type Kv = { k: string; v: ReactNode; mono?: boolean; hint?: string };

/** Borderless definition rows separated by hairlines. */
export function KeyValueList({ items, className }: { items: Kv[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-border/70", className)}>
      {items.map((it) => (
        <div key={it.k} className="flex items-baseline justify-between gap-6 py-2.5">
          <dt className="shrink-0 text-[13px] text-muted-foreground">{it.k}</dt>
          <dd
            className={cn(
              "min-w-0 truncate text-right text-[13.5px] font-medium",
              it.mono !== false && "font-mono",
            )}
            title={typeof it.v === "string" ? it.v : undefined}
          >
            {it.v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------- EmptyState ------------------------------ */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-14 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="mb-4 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </span>
      )}
      <h3 className="text-[15.5px] font-semibold">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-md text-[13.5px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* --------------------------------- Status -------------------------------- */

export type StatusTone = "good" | "warn" | "bad" | "neutral" | "unknown";

const DOT: Record<StatusTone, string> = {
  good: "bg-status-good",
  warn: "bg-status-warn",
  bad: "bg-status-bad",
  neutral: "bg-primary",
  unknown: "bg-muted-foreground",
};

/** Honest status label — a dot plus a word, never a scare-colored box. */
export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-muted-foreground",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT[tone])} aria-hidden="true" />
      {children}
    </span>
  );
}
