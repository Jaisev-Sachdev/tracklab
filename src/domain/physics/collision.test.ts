import { describe, expect, it } from "vitest";
import { fixture, gaussian, trackFrom, truth } from "../../../test/synthetic";
import { parseVideoText } from "../track/parse";
import { tracksFromRecords, type Track } from "../track/track";
import { analyseCollision } from "./collision";

/**
 * Two objects on a horizontal line meeting at tHit with the given velocities (px/s) before and after. Their centres
 * are `gapPx` apart at contact (the sum of their half-lengths).
 */
function collision(
  v: { a: [number, number]; b: [number, number] },
  opts: { tHit?: number; noisePx?: number; gapPx?: number } = {},
) {
  const { tHit = 1.5, noisePx = 0, gapPx = 60 } = opts;
  const noise = gaussian(11);
  const fps = 60;
  const frames = Array.from({ length: Math.round(3 * fps) }, (_, frame) => frame);
  const pos = (x0: number, [before, after]: [number, number], t: number) =>
    t < tHit ? x0 + before * (t - tHit) : x0 + after * (t - tHit);
  const make = (id: string, xHit: number, vel: [number, number]) =>
    trackFrom(
      id,
      frames.map((frame) => ({ frame, t: frame / fps, x: pos(xHit, vel, frame / fps) + noisePx * noise(), y: 300 })),
    );
  return { a: make("0", 600, v.a), b: make("1", 600 + gapPx, v.b) };
}

describe("analyseCollision", () => {
  it("finds conserved momentum and restitution 1 for an elastic collision of equal masses", () => {
    const { a, b } = collision({ a: [300, -200], b: [-200, 300] }, { noisePx: 0.7 });
    const r = analyseCollision(a, b, { massA: 0.2, massB: 0.2 });
    expect(r.contactT).toBeCloseTo(1.5, 1);
    expect(r.unit).toBe("px/s");
    expect(r.velocities.a.before.value).toBeCloseTo(300, -1);
    expect(r.momentumRatio.value).toBeCloseTo(1, 2);
    expect(r.restitution.value).toBeCloseTo(1, 2);
    expect(r.energyRatio.value).toBeCloseTo(1, 1);
    expect(r.warnings).toEqual([]);
  });

  it("finds contact between frames without a false 'tracks jump' warning", () => {
    // Contact at 1.508 s falls between 60 fps frames (1.5 and 1.5167 s).
    const { a, b } = collision({ a: [300, -200], b: [-200, 300] }, { tHit: 1.508, noisePx: 0.3 });
    const r = analyseCollision(a, b, { massA: 1, massB: 1 });
    expect(r.contactT).toBeCloseTo(1.508, 2);
    expect(r.warnings).toEqual([]);
  });

  it("finds restitution 0 when the objects stick, with unequal masses", () => {
    // 0.3 kg at 200 px/s hits 0.1 kg at rest; together they move at 150 px/s.
    const { a, b } = collision({ a: [200, 150], b: [0, 150] });
    const r = analyseCollision(a, b, { massA: 0.3, massB: 0.1, calibration: { pxPerM: 500, pxPerMSe: 0 } });
    expect(r.unit).toBe("m/s");
    expect(r.velocities.a.before.value).toBeCloseTo(0.4, 3);
    expect(r.momentumRatio.value).toBeCloseTo(1, 3);
    expect(r.restitution.value).toBeCloseTo(0, 3);
    expect(r.energyRatio.value).toBeCloseTo(0.75, 3);
  });

  it("finds the contact moment on a slow approach between long objects", () => {
    // Carts 200 px between centres at contact, closing at only 60 px/s.
    const { a, b } = collision({ a: [60, 0], b: [0, 60] }, { gapPx: 200, tHit: 2 });
    const r = analyseCollision(a, b, { massA: 1, massB: 1 });
    expect(r.contactT).toBeCloseTo(2, 1);
    expect(r.velocities.a.after.value).toBeCloseTo(0, 6);
    expect(r.restitution.value).toBeCloseTo(1, 6);
  });

  it("undoes an id swap at contact instead of reporting restitution −1", () => {
    const { a, b } = collision({ a: [300, -200], b: [-200, 300] }, { noisePx: 0.5 });
    const swapAfter = (x: Track, y: Track): Track => ({
      ...x,
      samples: [...x.samples.filter((s) => s.t < 1.5), ...y.samples.filter((s) => s.t >= 1.5)],
    });
    const r = analyseCollision(swapAfter(a, b), swapAfter(b, a), { massA: 1, massB: 1 });
    expect(r.restitution.value).toBeCloseTo(1, 1);
    expect(r.warnings.join(" ")).toMatch(/swapped/);
  });

  it("keeps the length scale's error out of the ratios, where it cancels", () => {
    const { a, b } = collision({ a: [300, -200], b: [-200, 300] }, { noisePx: 0.7 });
    const plain = analyseCollision(a, b, { massA: 1, massB: 1 });
    const scaled = analyseCollision(a, b, { massA: 1, massB: 1, calibration: { pxPerM: 800, pxPerMSe: 8 } });
    expect(scaled.momentumRatio).toEqual(plain.momentumRatio);
    expect(scaled.restitution).toEqual(plain.restitution);
    // Absolute values do carry it: a 1% scale error on a 0.375 m/s velocity is at least 0.00375 m/s.
    expect(scaled.velocities.a.before.se).toBeGreaterThan(0.0037);
    expect(plain.momentumRatio.se).toBeGreaterThan(0);
  });

  it("handles exactly zero momentum after without a NaN error", () => {
    // Equal masses, equal and opposite speeds, sticking: momentum before is 0 too, so it warns.
    const { a, b } = collision({ a: [100, 0], b: [-100, 0] });
    const r = analyseCollision(a, b, { massA: 1, massB: 1 });
    expect(Number.isNaN(r.restitution.se)).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/close to zero/);
  });

  it("refuses when there is no clean footage before the collision", () => {
    const { a, b } = collision({ a: [300, -200], b: [-200, 300] }, { tHit: 0.05 });
    expect(() => analyseCollision(a, b, { massA: 1, massB: 1 })).toThrow(/no collision|Not enough clean frames/);
  });

  it("refuses when nothing collides", () => {
    const { a, b } = collision({ a: [100, 100], b: [-50, -50] }, { noisePx: 0.5 });
    expect(() => analyseCollision(a, b, { massA: 1, massB: 1 })).toThrow(/no collision/);
  });

  it("checks momentum on SAM 3.1's real output on the synthetic collision clip", async () => {
    const tr = truth();
    const { records } = await parseVideoText(fixture("sam-collision-synthetic.txt"));
    const frameTimes = Array.from({ length: 120 }, (_, i) => i / tr.fps);
    const [a, b] = tracksFromRecords(records, { frameTimes, width: 1280, height: 720 });
    const r = analyseCollision(a!, b!, { massA: 1, massB: 1 });
    expect(Math.abs(r.contactT - tr.collision.tHit)).toBeLessThan(0.005);
    expect(r.warnings).toEqual([]);
    for (const m of [r.momentumRatio, r.restitution]) {
      expect(Math.abs(m.value - 1)).toBeLessThan(0.02);
      expect(Math.abs(m.value - 1)).toBeLessThan(4 * m.se + 0.002);
    }
  });
});
