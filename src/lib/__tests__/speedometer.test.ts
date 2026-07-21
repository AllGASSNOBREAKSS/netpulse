import { describe, expect, it } from "vitest";
import { speedBand, speedToDialFraction } from "../speedometer";

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
});
