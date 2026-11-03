import { describe, expect, it } from "vitest";
import { formatMeasured, sigmaFrom } from "./format";

describe("formatMeasured", () => {
  it("rounds the error to two significant figures and the value to match", () => {
    expect(formatMeasured({ value: 9.78683, se: 0.03671 }, "m/s²")).toBe("9.787 ± 0.037 m/s²");
    expect(formatMeasured({ value: 1.421123, se: 0.00008 })).toBe("1.421123 ± 0.000080");
    expect(formatMeasured({ value: 312.7, se: 14.2 }, "px/s")).toBe("313 ± 14 px/s");
  });

  it("copes with missing or zero errors and non-finite values", () => {
    expect(formatMeasured({ value: 0.5, se: 0 }, "m")).toBe("0.5000 m");
    expect(formatMeasured({ value: Number.NaN, se: 1 })).toBe("—");
  });
});

describe("sigmaFrom", () => {
  it("measures distance from the expected value in standard errors", () => {
    expect(sigmaFrom({ value: 9.75, se: 0.03 }, 9.81)).toBeCloseTo(-2, 9);
  });
});
