import "@arclux/arc-ui/animated-number";
import "@arclux/arc-ui/connection-status";
import "@arclux/arc-ui/footer";
import "@arclux/arc-ui/meter";
import "@arclux/arc-ui/sparkline";
import { createElement, type HTMLAttributes, type ReactNode } from "react";

type ArcBaseProps = HTMLAttributes<HTMLElement> & { children?: ReactNode };

export function ArcAnimatedNumber({
  value,
  duration = 500,
  decimals,
  prefix,
  suffix,
  className,
  ...props
}: ArcBaseProps & {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
}) {
  return createElement("arc-animated-number", { value, duration, decimals, prefix, suffix, class: className, ...props });
}

export function ArcMeter({
  value,
  min = 0,
  max = 100,
  low,
  high,
  optimum,
  label,
  className,
  ...props
}: ArcBaseProps & {
  value: number;
  min?: number;
  max?: number;
  low?: number;
  high?: number;
  optimum?: number;
  label?: string;
}) {
  return createElement("arc-meter", { value, min, max, low, high, optimum, label, class: className, ...props });
}

export function ArcSparkline({
  data,
  type = "line",
  color = "var(--accent-primary)",
  width = 180,
  height = 42,
  fill,
  className,
  ...props
}: ArcBaseProps & {
  data: number[];
  type?: "line" | "bar" | "area";
  color?: string;
  width?: number;
  height?: number;
  fill?: boolean;
}) {
  return createElement("arc-sparkline", {
    data: data.join(","),
    type,
    color,
    width,
    height,
    fill: fill ? "" : undefined,
    class: className,
    ...props,
  });
}

export function ArcConnectionStatus({ className, ...props }: ArcBaseProps) {
  return createElement("arc-connection-status", { class: className, ...props });
}

export function ArcFooter({ compact = true, border = true, className, ...props }: ArcBaseProps & { compact?: boolean; border?: boolean }) {
  return createElement("arc-footer", {
    compact: compact ? "" : undefined,
    border: border ? "" : undefined,
    class: className,
    ...props,
  });
}
