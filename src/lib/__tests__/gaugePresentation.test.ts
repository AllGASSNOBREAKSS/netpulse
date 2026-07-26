import { describe, expect, it } from "vitest";
import { gaugeNumeral } from "../gaugePresentation";

describe("gauge publication state", () => {
  it("does not leave a partial live value visible as a final result after failure", () => {
    expect(gaugeNumeral(338.4, true, null)).toBe("—");
  });

  it("does not display an unmeasured upload as 0.0 after failure", () => {
    expect(gaugeNumeral(0, true, null)).toBe("—");
  });

  it("settles on the real published result when evidence is available", () => {
    expect(gaugeNumeral(596.2, true, 596.2)).toBe("596");
  });
});
