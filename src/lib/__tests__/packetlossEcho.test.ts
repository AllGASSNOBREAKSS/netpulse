import { describe, expect, it } from "vitest";
import { summarizeEchoDelivery } from "../packetloss";

describe("controlled echo delivery summary", () => {
  it("counts unique delivery, lateness, and observable reordering", () => {
    const result = summarizeEchoDelivery({
      sent: 5,
      receivedSequences: [0, 2, 1, 2, 4],
      lateSequences: new Set([2, 4]),
      durationMs: 900,
    });
    expect(result.received).toBe(4);
    expect(result.messageLossPct).toBe(20);
    expect(result.reordered).toBe(1);
    expect(result.late).toBe(2);
    expect(result.packetLossPct).toBeNull();
  });
});
