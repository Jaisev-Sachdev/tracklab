import { describe, expect, it } from "vitest";
import { fixture, gaussian, trackFrom, truth } from "../../../test/synthetic";
import { parseVideoText } from "../track/parse";
import { tracksFromRecords } from "../track/track";
import { analyseCollision } from "./collision";

/** Two objects on a horizontal line meeting at tHit with the given velocities (px/s) before and after. */
function collision(v: { a: [number, number]; b: [number, number] }, tHit = 1.5, noisePx = 0) {
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
  return { a: make("0", 600, v.a), b: make("1", 660, v.b) };
}

describe("analyseCollision", () => {
  it("finds conserved momentum and restitution 1 for an elastic collision of equal masses", () => {
    const { a, b } = collision({ a: [300, -200], b: [-200, 300] }, 1.5, 0.7);
    const r = analyseCollision(a, b, { massA: 0.2, massB: 0.2 });
    expect(r.contactT).toBeCloseTo(1.5, 1);
    expect(r.unit).toBe("px/s");
    expect(r.velocities.a.before.value).toBeCloseTo(300, -1);
    expect(r.momentumRatio.value).toBeCloseTo(1, 2);
    expect(r.restitution.value).toBeCloseTo(1, 2);
    expect(r.energyRatio).toBeCloseTo(1, 1);
  });

  it("finds restitution 0 when the objects stick, with unequal masses", () => {
    // 0.3 kg at 200 px/s hits 0.1 kg at rest; together they move at 150 px/s.
    const { a, b } = collision({ a: [200, 150], b: [0, 150] });
    const r = analyseCollision(a, b, { massA: 0.3, massB: 0.1, calibration: { pxPerM: 500, pxPerMSe: 0 } });
    expect(r.unit).toBe("m/s");
    expect(r.velocities.a.before.value).toBeCloseTo(0.4, 3);
    expect(r.momentumRatio.value).toBeCloseTo(1, 3);
    expect(r.restitution.value).toBeCloseTo(0, 3);
    expect(r.energyRatio).toBeCloseTo(0.75, 3);
  });

  it("refuses when there is no clean footage before the collision", () => {
    const { a, b } = collision({ a: [300, -200], b: [-200, 300] }, 0.05);
    expect(() => analyseCollision(a, b, { massA: 1, massB: 1 })).toThrow(/Not enough clean frames/);
  });

  it("checks momentum on SAM 3.1's real output on the synthetic collision clip", async () => {
    const tr = truth();
    const { records } = await parseVideoText(fixture("sam-collision-synthetic.txt"));
    const frameTimes = Array.from({ length: 120 }, (_, i) => i / tr.fps);
    const [a, b] = tracksFromRecords(records, { frameTimes, width: 1280, height: 720 });
    const r = analyseCollision(a!, b!, { massA: 1, massB: 1 });
    expect(Math.abs(r.contactT - tr.collision.tHit)).toBeLessThan(0.05);
    expect(r.momentumRatio.value).toBeGreaterThan(0.98);
    expect(r.momentumRatio.value).toBeLessThan(1.02);
    expect(r.restitution.value).toBeGreaterThan(0.97);
    expect(r.restitution.value).toBeLessThan(1.03);
  });
});
