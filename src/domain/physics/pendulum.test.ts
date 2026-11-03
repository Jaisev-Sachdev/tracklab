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

describe("analysePendulum", () => {
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
