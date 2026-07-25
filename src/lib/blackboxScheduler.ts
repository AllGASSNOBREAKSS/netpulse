export type SchedulerTick = {
  scheduledAt: number;
  schedulingDelayMs: number;
};

export async function runBlackBoxScheduler(options: {
  intervalMs: number;
  signal: AbortSignal;
  onTick: (tick: SchedulerTick) => Promise<void>;
  monotonicNow?: () => number;
  wallNow?: () => number;
}): Promise<void> {
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const wallNow = options.wallNow ?? (() => Date.now());
  let target = monotonicNow();

  while (!options.signal.aborted) {
    const beforeWait = monotonicNow();
    await abortableDelay(Math.max(0, target - beforeWait), options.signal);
    if (options.signal.aborted) break;

    const started = monotonicNow();
    const schedulingDelayMs = Math.max(0, started - target);
    const scheduledAt = wallNow() - schedulingDelayMs;
    await options.onTick({ scheduledAt, schedulingDelayMs });

    target += options.intervalMs;
    const afterTick = monotonicNow();
    if (afterTick - target > options.intervalMs) target = afterTick + options.intervalMs;
  }
}

export function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || delayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
  });
}
