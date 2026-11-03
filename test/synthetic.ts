// Test helpers: seeded noise, synthetic tracks, and the spike's real SAM output.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Sample, Track } from "@/domain/track/track";

/** Deterministic PRNG (mulberry32) so noisy tests never flake. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sampler (Box–Muller) on top of `rng`. */
export function gaussian(seed: number): () => number {
  const u = rng(seed);
  return () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());
}

export function trackFrom(objectId: string, points: { frame: number; t: number; x: number; y: number }[]): Track {
  const samples: Sample[] = points.map((p) => ({
    ...p,
    box: { left: p.x - 10, top: p.y - 10, right: p.x + 10, bottom: p.y + 10 },
    clipped: false,
  }));
  return { objectId, samples };
}

export const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");

export type SyntheticTruth = {
  fps: number;
  pendulum: {
    g: number;
    pxPerM: number;
    lengthPx: number;
    lengthM: number;
    theta0Rad: number;
    periodS: number;
    pivot: { x: number; y: number };
  };
  collision: { y: number; a: { x0: number; v: number }; b: { x0: number; v: number }; tHit: number };
};

export const truth = (): SyntheticTruth => JSON.parse(fixture("synthetic-truth.json"));
