import { describe, expect, it } from "vitest";
import { gaussian } from "../../../test/synthetic";
import { fitCircle, fitLine, levenbergMarquardt } from "./least-squares";

describe("fitLine", () => {
  it("recovers an exact line with zero error", () => {
    const xs = [0, 1, 2, 3, 4];
    const fit = fitLine(
      xs,
      xs.map((x) => 3 * x - 2),
    );
    expect(fit.slope).toBeCloseTo(3, 12);
    expect(fit.intercept).toBeCloseTo(-2, 12);
    expect(fit.slopeSe).toBeCloseTo(0, 12);
  });

  it("reports a slope error that matches the scatter of repeated noisy fits", () => {
    const noise = gaussian(1);
    const xs = Array.from({ length: 30 }, (_, i) => i / 30);
    const slopes: number[] = [];
    const ses: number[] = [];
    for (let k = 0; k < 400; k++) {
      const f = fitLine(
        xs,
        xs.map((x) => 5 * x + noise()),
      );
      slopes.push(f.slope);
      ses.push(f.slopeSe);
    }
    const mean = slopes.reduce((s, v) => s + v, 0) / slopes.length;
    const sd = Math.sqrt(slopes.reduce((s, v) => s + (v - mean) ** 2, 0) / (slopes.length - 1));
    const meanSe = ses.reduce((s, v) => s + v, 0) / ses.length;
    expect(mean).toBeCloseTo(5, 0);
    expect(meanSe / sd).toBeGreaterThan(0.85);
    expect(meanSe / sd).toBeLessThan(1.15);
  });

  it("rejects degenerate input", () => {
    expect(() => fitLine([1], [1])).toThrow();
    expect(() => fitLine([2, 2, 2], [1, 2, 3])).toThrow();
  });
});

describe("levenbergMarquardt", () => {
  it("fits a damped cosine from a rough start", () => {
    const noise = gaussian(2);
    const model = (p: readonly number[], t: number) =>
      p[0]! * Math.exp(-p[1]! * t) * Math.cos(p[2]! * t + p[3]!) + p[4]!;
    const truthP = [0.2, 0.05, 4.4, 0.3, 0.01];
    const ts = Array.from({ length: 300 }, (_, i) => i / 30);
    const ys = ts.map((t) => model(truthP, t) + 0.002 * noise());
    const fit = levenbergMarquardt(model, ts, ys, [0.15, 0, 4.2, 0, 0]);
    expect(fit.converged).toBe(true);
    expect(fit.params[2]).toBeCloseTo(4.4, 3);
    expect(fit.params[1]).toBeCloseTo(0.05, 2);
    expect(fit.rms).toBeLessThan(0.0025);
    // Truth lies within 4 standard errors for every parameter.
    fit.params.forEach((p, i) => expect(Math.abs(p - truthP[i]!)).toBeLessThan(4 * fit.stdErrors[i]! + 1e-9));
  });
});

describe("fitCircle", () => {
  it("is honest that a short noisy arc barely constrains the radius", () => {
    const noise = gaussian(3);
    const angles = Array.from({ length: 200 }, (_, i) => -0.17 + (0.34 * i) / 199);
    const c = fitCircle(
      angles.map((a) => 640 + 400 * Math.sin(a) + noise()),
      angles.map((a) => 100 + 400 * Math.cos(a) + noise()),
    );
    expect(Math.abs(c.r - 400)).toBeLessThan(4 * c.rSe);
    expect(c.rSe / c.r).toBeGreaterThan(0.02);
  });

  it("pins down centre and radius from a long arc", () => {
    const noise = gaussian(4);
    const angles = Array.from({ length: 200 }, (_, i) => -0.7 + (1.4 * i) / 199);
    const c = fitCircle(
      angles.map((a) => 640 + 400 * Math.sin(a) + noise()),
      angles.map((a) => 100 + 400 * Math.cos(a) + noise()),
    );
    expect(Math.abs(c.r - 400)).toBeLessThan(4 * c.rSe);
    expect(c.rSe / c.r).toBeLessThan(0.01);
    expect(Math.abs(c.cx - 640)).toBeLessThan(2);
  });

  it("rejects collinear points", () => {
    expect(() => fitCircle([0, 1, 2], [0, 1, 2])).toThrow();
  });
});
