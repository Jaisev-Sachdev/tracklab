import { describe, expect, it } from "vitest";
import { calibrationFromLine } from "./calibration";

describe("calibrationFromLine", () => {
  it("converts a drawn line of known length to pixels per metre with an uncertainty", () => {
    const c = calibrationFromLine({ x1: 100, y1: 200, x2: 500, y2: 200 }, 0.5);
    expect(c.pxPerM).toBe(800);
    // 2.1 px end error on 400 px and 1 mm on 500 mm: about 0.55%.
    expect(c.pxPerMSe / c.pxPerM).toBeCloseTo(0.0055, 3);
  });

  it("rejects a line too short to be useful", () => {
    expect(() => calibrationFromLine({ x1: 0, y1: 0, x2: 10, y2: 0 }, 0.3)).toThrow(/too short/);
  });
});
