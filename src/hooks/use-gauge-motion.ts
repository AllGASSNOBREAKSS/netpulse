import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { interpolateSpeed } from "@/lib/speedometer";

export type GaugeValues = {
  download: number;
  upload: number;
};

const ZERO_VALUES: GaugeValues = { download: 0, upload: 0 };

function measuredValue(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * One requestAnimationFrame clock drives both gauges. A target update cancels
 * the previous frame before the next loop starts, so there is never more than
 * one competing animation. Values are always interpolated from real samples.
 */
export function useGaugeMotion(targets: GaugeValues): GaugeValues {
  const reducedMotion = useReducedMotion();
  const currentRef = useRef<GaugeValues>(ZERO_VALUES);
  const targetRef = useRef<GaugeValues>(ZERO_VALUES);
  const reducedMotionRef = useRef(reducedMotion);
  const [display, setDisplay] = useState<GaugeValues>(ZERO_VALUES);

  useEffect(() => {
    targetRef.current = {
      download: measuredValue(targets.download),
      upload: measuredValue(targets.upload),
    };
  }, [targets.download, targets.upload]);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    let frameId = 0;
    let previousTime: number | null = null;

    const tick = (time: number) => {
      const deltaSeconds = previousTime === null
        ? 1 / 60
        : Math.min((time - previousTime) / 1000, 1 / 30);
      previousTime = time;

      const target = targetRef.current;
      const next = reducedMotionRef.current
        ? target
        : {
            download: interpolateSpeed(currentRef.current.download, target.download, deltaSeconds),
            upload: interpolateSpeed(currentRef.current.upload, target.upload, deltaSeconds),
          };
      if (next.download !== currentRef.current.download || next.upload !== currentRef.current.upload) {
        currentRef.current = next;
        setDisplay(next);
      }
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);

  return display;
}
