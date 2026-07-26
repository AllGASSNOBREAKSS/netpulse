import { describe, expect, it } from "vitest";
import { VisualTelemetry } from "../visualTelemetry";

describe("visual telemetry", () => {
  it("throttles presentation targets and smooths only real samples", () => {
    const telemetry = new VisualTelemetry({ windowMs: 1_000, emitIntervalMs: 225, smoothing: 0.5 });
    expect(telemetry.push(100, 0)).toBeNull();
    expect(telemetry.push(900, 100)).toBeNull();
    expect(telemetry.push(110, 225)).toBe(110);
    expect(telemetry.push(Number.NaN, 500)).toBeNull();
  });

  it("forgets previous-run state when reset", () => {
    const telemetry = new VisualTelemetry();
    expect(telemetry.push(500, 0)).toBeNull();
    expect(telemetry.push(500, 225)).toBe(500);
    telemetry.reset();
    expect(telemetry.push(25, 0)).toBeNull();
    expect(telemetry.push(25, 225)).toBe(25);
  });
});
