import { describe, expect, it } from "vitest";
import { fixture, truth } from "../../../test/synthetic";
import { parseVideoText } from "./parse";
import { coverage, tracksFromRecords, type Track } from "./track";

describe("tracksFromRecords", () => {
  it("keeps each ball's id through a collision and flags frames where a ball leaves the picture", async () => {
    const tr = truth();
    const { records } = await parseVideoText(fixture("sam-collision-synthetic.txt"));
    const frameTimes = Array.from({ length: 120 }, (_, i) => i / tr.fps);
    const tracks = tracksFromRecords(records, { frameTimes, width: 1280, height: 720 });
    expect(tracks).toHaveLength(2);

    // Ball A starts left and stays fully in view; ball B leaves through the right edge near the end.
    const [a, b] = [...tracks].sort((p, q) => p.samples[0]!.x - q.samples[0]!.x) as [Track, Track];
    expect(a.samples).toHaveLength(120);
    expect(a.samples[30]!.t).toBeCloseTo(1, 9);
    expect(coverage(a, 120)).toMatchObject({ fraction: 1, clippedFrames: 0, longestGap: 0 });

    const covB = coverage(b, 120);
    expect(covB.framesTracked).toBeLessThan(120);
    expect(covB.clippedFrames).toBeGreaterThan(0);
    expect(b.samples.at(-1)!.clipped).toBe(true);
    expect(b.samples.filter((s) => s.t < 3).every((s) => !s.clipped)).toBe(true);
  });

  it("puts mask centroids within 3 px of the true position on real SAM output", async () => {
    const tr = truth();
    const { records, diagnostics } = await parseVideoText(fixture("sam-pendulum-synthetic.txt"));
    expect(diagnostics).toBe(0);
    const frameTimes = Array.from({ length: 300 }, (_, i) => i / tr.fps);
    const [track] = tracksFromRecords(records, { frameTimes, width: 1280, height: 720 });
    expect(track!.samples).toHaveLength(300);

    const p = tr.pendulum;
    const errors = track!.samples.map((s) => {
      const th = p.theta0Rad * Math.cos((2 * Math.PI * s.t) / p.periodS);
      return Math.hypot(s.x - (p.pivot.x + p.lengthPx * Math.sin(th)), s.y - (p.pivot.y + p.lengthPx * Math.cos(th)));
    });
    expect(Math.max(...errors)).toBeLessThan(3);
  });
});
