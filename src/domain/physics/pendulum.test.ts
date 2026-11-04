import { describe, expect, it } from "vitest";
import { fixture, gaussian, trackFrom, truth } from "../../../test/synthetic";
import { parseVideoText } from "../track/parse";
import { tracksFromRecords } from "../track/track";
import { analysePendulum } from "./pendulum";

const G = 9.81;

/** A pendulum of length L (m) seen at `pxPerM`, with optional damping and pixel noise. */
function pendulumTrack(opts: {
  L: number;
  theta0Deg: number;
  pxPerM: number;
  damping?: number;
  noisePx?: number;
  seconds?: number;
  fps?: number;
}) {
  const { L, pxPerM, damping = 0, noisePx = 0, seconds = 10, fps = 30 } = opts;
  const th0 = (opts.theta0Deg * Math.PI) / 180;
  // Period at this amplitude (series correction), matching what the analysis inverts.
  const T = 2 * Math.PI * Math.sqrt(L / G) * (1 + th0 ** 2 / 16);
  const noise = gaussian(7);
  const pivot = { x: 640, y: 80 };
  const points = Array.from({ length: Math.round(seconds * fps) }, (_, frame) => {
    const t = frame / fps;
    const th = th0 * Math.exp(-damping * t) * Math.cos((2 * Math.PI * t) / T);
    return {
      frame,
      t,
      x: pivot.x + L * pxPerM * Math.sin(th) + noisePx * noise(),
      y: pivot.y + L * pxPerM * Math.cos(th) + noisePx * noise(),
    };
  });
  return { track: trackFrom("0", points), pivot };
}

/**
 * Independent ground truth: integrate the full nonlinear equation θ'' = −(g/L)·sin θ − 2γ·θ' with RK4, so the
 * amplitude correction and the damping separation are checked against physics, not against the formula they use.
 */
function integratedPendulum(opts: { L: number; theta0Deg: number; gamma: number; pxPerM: number; noisePx: number }) {
  const { L, gamma, pxPerM, noisePx } = opts;
  const fps = 30;
  const steps = 40; // RK4 substeps per frame
  const h = 1 / fps / steps;
  const f = (th: number, w: number) => [w, -(G / L) * Math.sin(th) - 2 * gamma * w] as const;
  let th = (opts.theta0Deg * Math.PI) / 180;
  let w = 0;
  const noise = gaussian(9);
  const pivot = { x: 640, y: 60 };
  const points = [];
  for (let frame = 0; frame < 12 * fps; frame++) {
    points.push({
      frame,
      t: frame / fps,
      x: pivot.x + L * pxPerM * Math.sin(th) + noisePx * noise(),
      y: pivot.y + L * pxPerM * Math.cos(th) + noisePx * noise(),
    });
    for (let s = 0; s < steps; s++) {
      const k1 = f(th, w);
      const k2 = f(th + (h / 2) * k1[0], w + (h / 2) * k1[1]);
      const k3 = f(th + (h / 2) * k2[0], w + (h / 2) * k2[1]);
      const k4 = f(th + h * k3[0], w + h * k3[1]);
      th += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      w += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    }
  }
  return { track: trackFrom("0", points), pivot };
}

describe("analysePendulum", () => {
  it.each([
    { theta0Deg: 5, gamma: 0 },
    { theta0Deg: 15, gamma: 0 },
    { theta0Deg: 15, gamma: 0.06 },
  ])(
    "recovers g within 0.3% from an integrated nonlinear pendulum ($theta0Deg°, γ = $gamma)",
    ({ theta0Deg, gamma }) => {
      const { track, pivot } = integratedPendulum({ L: 0.6, theta0Deg, gamma, pxPerM: 900, noisePx: 0.7 });
      const r = analysePendulum(track, { pivot, calibration: { pxPerM: 900, pxPerMSe: 0 } });
      expect(Math.abs(r.g!.value / G - 1)).toBeLessThan(0.003);
      expect(Math.abs(r.g!.value - G)).toBeLessThan(4 * r.g!.se);
    },
  );

  it("recovers g within 0.5% from a noisy calibrated track", () => {
    const { track, pivot } = pendulumTrack({ L: 0.75, theta0Deg: 12, pxPerM: 700, noisePx: 1 });
    const r = analysePendulum(track, { pivot, calibration: { pxPerM: 700, pxPerMSe: 2 } });
    expect(r.g!.value).toBeGreaterThan(G * 0.995);
    expect(r.g!.value).toBeLessThan(G * 1.005);
    expect(Math.abs(r.g!.value - G)).toBeLessThan(3 * r.g!.se);
    expect(r.lengthUsedM!.source).toBe("video");
    expect(r.amplitudeDeg).toBeCloseTo(12, 0);
  });

  it("separates damping from the period", () => {
    const r = analysePendulum(
      pendulumTrack({ L: 0.5, theta0Deg: 10, pxPerM: 800, damping: 0.08, noisePx: 0.5 }).track,
      {
        measuredLengthM: { value: 0.5, se: 0.002 },
      },
    );
    expect(r.dampingPerS).toBeCloseTo(0.08, 2);
    expect(r.g!.value / G).toBeCloseTo(1, 2);
    expect(r.lengthUsedM!.source).toBe("measured");
  });

  it("gives a period but no g without a length scale, and says why", () => {
    const r = analysePendulum(pendulumTrack({ L: 0.5, theta0Deg: 8, pxPerM: 800 }).track);
    expect(r.g).toBeUndefined();
    expect(r.smallAnglePeriodS.value).toBeCloseTo(2 * Math.PI * Math.sqrt(0.5 / G), 3);
    expect(r.warnings.join(" ")).toMatch(/No length scale/);
  });

  it("warns about large swings and short clips", () => {
    const r = analysePendulum(pendulumTrack({ L: 0.5, theta0Deg: 30, pxPerM: 800, seconds: 3.5 }).track);
    const w = r.warnings.join(" ");
    expect(w).toMatch(/Large swing/);
    expect(w).toMatch(/swings filmed/);
  });

  it("won't give g from a pivot fitted to the arc, but still measures the period", () => {
    const { track } = pendulumTrack({ L: 0.5, theta0Deg: 8, pxPerM: 800, noisePx: 1 });
    const r = analysePendulum(track, { calibration: { pxPerM: 800, pxPerMSe: 0 } });
    expect(r.pivot.source).toBe("fitted");
    expect(r.g).toBeUndefined();
    expect(r.warnings.join(" ")).toMatch(/Mark the pivot/);
    // The period doesn't depend on knowing the pivot.
    expect(r.smallAnglePeriodS.value).toBeCloseTo(2 * Math.PI * Math.sqrt(0.5 / G), 2);
  });

  it("measures g within 1% from SAM 3.1's real output on the synthetic clip", async () => {
    const tr = truth();
    const { records } = await parseVideoText(fixture("sam-pendulum-synthetic.txt"));
    const frameTimes = Array.from({ length: 300 }, (_, i) => i / tr.fps);
    const [track] = tracksFromRecords(records, { frameTimes, width: 1280, height: 720 });
    const r = analysePendulum(track!, {
      pivot: tr.pendulum.pivot,
      calibration: { pxPerM: tr.pendulum.pxPerM, pxPerMSe: 0 },
    });
    expect(Math.abs(r.g!.value - tr.pendulum.g) / tr.pendulum.g).toBeLessThan(0.01);
    expect(Math.abs(r.periodS.value - tr.pendulum.periodS)).toBeLessThan(0.002);
  });
});

describe("uncertainty budget", () => {
  it("says what limits g: the scale line here, not the period", async () => {
    const tr = truth();
    const { records } = await parseVideoText(fixture("sam-pendulum-synthetic.txt"));
    const frameTimes = Array.from({ length: 300 }, (_, i) => i / tr.fps);
    const [track] = tracksFromRecords(records, { frameTimes, width: 1280, height: 720 });
    const r = analysePendulum(track!, { pivot: tr.pendulum.pivot, calibration: { pxPerM: 800, pxPerMSe: 4.5 } });
    const b = r.uncertaintyBudget!;
    expect(b.scaleLine! + b.pivotAndTracking! + b.period!).toBeCloseTo(1, 9);
    expect(b.scaleLine).toBeGreaterThan(0.5);
    expect(b.period).toBeLessThan(0.01);
  });
});
