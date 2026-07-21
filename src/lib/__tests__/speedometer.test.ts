import { describe, expect, it } from "vitest";
import { interpolateSpeed, speedBand, speedToDialFraction } from "../speedometer";

describe("speedometer scale", () => {
  it("uses the requested fixed speed bands", () => {
    expect(speedBand(0)).toBe("blue");
    expect(speedBand(99.9)).toBe("blue");
    expect(speedBand(100)).toBe("yellow");
    expect(speedBand(199.9)).toBe("yellow");
    expect(speedBand(200)).toBe("orange");
    expect(speedBand(499.9)).toBe("orange");
    expect(speedBand(500)).toBe("red");
    expect(speedBand(5000)).toBe("red");
  });

  it("maps every band to one quarter of the dial without dynamic rescaling", () => {
    expect(speedToDialFraction(0)).toBe(0);
    expect(speedToDialFraction(100)).toBe(0.25);
    expect(speedToDialFraction(200)).toBe(0.5);
    expect(speedToDialFraction(500)).toBe(0.75);
    expect(speedToDialFraction(3000)).toBe(1);
    expect(speedToDialFraction(8000)).toBe(1);
  });

  it("clamps invalid and negative inputs to zero", () => {
    expect(speedToDialFraction(-100)).toBe(0);
    expect(speedToDialFraction(Number.NaN)).toBe(0);
  });

  it.each([0, 12.5, 99.9, 100, 175, 200, 420, 500, 1000, 3000, 8000])(
    "interpolates smoothly toward %s Mbps without overshoot",
    (target) => {
      let value = 0;
      for (let frame = 0; frame < 1_200; frame += 1) {
        const next = interpolateSpeed(value, target, 1 / 144);
        expect(next).toBeGreaterThanOrEqual(value);
        expect(next).toBeLessThanOrEqual(target);
        value = next;
      }
      expect(value).toBe(target);
    },
  );

  it("uses the same frame-rate-independent response at 60 Hz and 144 Hz", () => {
    const animateForOneSecond = (frames: number) => {
      let value = 0;
      for (let frame = 0; frame < frames; frame += 1) {
        value = interpolateSpeed(value, 500, 1 / frames);
      }
      return value;
    };

    expect(animateForOneSecond(60)).toBeCloseTo(animateForOneSecond(144), 8);
  });
});
