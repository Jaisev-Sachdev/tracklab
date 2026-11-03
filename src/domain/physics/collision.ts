// 1-D collision analysis: velocities just before and after contact, momentum and restitution.
import { fitLine, type LineFit } from "../fit/least-squares";
import type { Sample, Track } from "../track/track";
import type { Calibration, Measured } from "./types";

export type CollisionOptions = {
  massA: number;
  massB: number;
  calibration?: Calibration;
  /** Seconds either side of contact left out of the velocity fits (contact, squash, blur). */
  excludeS?: number;
  /** Seconds either side of the excluded window used for each velocity fit (keeps friction small). */
  fitWindowS?: number;
};

export type Velocities = { before: Measured; after: Measured };

export type CollisionResult = {
  objectIds: [string, string];
  contactT: number;
  /** Unit vector of the line of motion in image coordinates. */
  axis: { x: number; y: number };
  unit: "m/s" | "px/s";
  velocities: { a: Velocities; b: Velocities };
  momentumBefore: Measured;
  momentumAfter: Measured;
  /** after / before; 1 means momentum was conserved. Independent of the length scale. */
  momentumRatio: Measured;
  /** Separation speed / approach speed; 1 is perfectly elastic, 0 is sticking. */
  restitution: Measured;
  /** Kinetic energy after / before. */
  energyRatio: number;
  warnings: string[];
};

/** Principal direction of a point cloud (largest-variance eigenvector of the 2×2 covariance). */
function principalAxis(points: readonly { x: number; y: number }[]): { x: number; y: number } {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let ax = { x: Math.cos(angle), y: Math.sin(angle) };
  // Point the axis rightwards (or down for vertical motion) so signs read naturally.
  if (ax.x < -1e-9 || (Math.abs(ax.x) <= 1e-9 && ax.y < 0)) ax = { x: -ax.x, y: -ax.y };
  return ax;
}

function velocity(
  samples: readonly Sample[],
  axis: { x: number; y: number },
  from: number,
  to: number,
): LineFit | undefined {
  const window = samples.filter((s) => !s.clipped && s.t >= from && s.t <= to);
  if (window.length < 4) return undefined;
  return fitLine(
    window.map((s) => s.t),
    window.map((s) => s.x * axis.x + s.y * axis.y),
  );
}

const ratio = (num: Measured, den: Measured): Measured => {
  const value = num.value / den.value;
  return { value, se: Math.abs(value) * Math.hypot(num.se / num.value, den.se / den.value) };
};

export function analyseCollision(a: Track, b: Track, opts: CollisionOptions): CollisionResult {
  const warnings: string[] = [];
  const exclude = opts.excludeS ?? 0.1;
  const window = opts.fitWindowS ?? 0.6;

  // Contact: the first frame where the centres come within a hair of their closest approach.
  const bByFrame = new Map(b.samples.map((s) => [s.frame, s]));
  const pairs = a.samples
    .map((sa) => ({ sa, sb: bByFrame.get(sa.frame) }))
    .filter((p): p is { sa: Sample; sb: Sample } => p.sb !== undefined);
  if (pairs.length < 8) throw new Error("The two objects are rarely in view together; can't find the collision.");
  const dist = pairs.map(({ sa, sb }) => Math.hypot(sa.x - sb.x, sa.y - sb.y));
  const dMin = Math.min(...dist);
  const contactIdx = dist.findIndex((d) => d <= dMin + Math.max(2, 0.05 * dMin));
  const contactT = pairs[contactIdx]!.sa.t;

  const axis = principalAxis([...a.samples, ...b.samples].filter((s) => !s.clipped));
  const fits = {
    aBefore: velocity(a.samples, axis, contactT - exclude - window, contactT - exclude),
    aAfter: velocity(a.samples, axis, contactT + exclude, contactT + exclude + window),
    bBefore: velocity(b.samples, axis, contactT - exclude - window, contactT - exclude),
    bAfter: velocity(b.samples, axis, contactT + exclude, contactT + exclude + window),
  };
  const missing = Object.entries(fits)
    .filter(([, f]) => !f)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(
      `Not enough clean frames near the collision for: ${missing.join(", ")}. Film longer before and after.`,
    );
  }

  const scale = opts.calibration?.pxPerM ?? 1;
  const scaleRel = opts.calibration ? opts.calibration.pxPerMSe / opts.calibration.pxPerM : 0;
  const v = (f: LineFit | undefined): Measured => {
    const value = f!.slope / scale;
    return { value, se: Math.hypot(f!.slopeSe / scale, value * scaleRel) };
  };
  const va = { before: v(fits.aBefore), after: v(fits.aAfter) };
  const vb = { before: v(fits.bBefore), after: v(fits.bAfter) };

  const { massA: ma, massB: mb } = opts;
  const momentum = (x: Measured, y: Measured): Measured => ({
    value: ma * x.value + mb * y.value,
    se: Math.hypot(ma * x.se, mb * y.se),
  });
  const pBefore = momentum(va.before, vb.before);
  const pAfter = momentum(va.after, vb.after);

  const approach = { value: va.before.value - vb.before.value, se: Math.hypot(va.before.se, vb.before.se) };
  const separation = { value: vb.after.value - va.after.value, se: Math.hypot(va.after.se, vb.after.se) };
  const ke = (x: number, y: number) => ma * x * x + mb * y * y;

  if (Math.abs(pBefore.value) < 3 * pBefore.se) {
    warnings.push("Total momentum before the collision is close to zero, so the conservation ratio is unstable.");
  }
  for (const [name, f] of Object.entries(fits)) {
    const span = Math.abs(f!.slope) * window;
    if (f!.rms > Math.max(2, 0.05 * span))
      warnings.push(`Velocity fit ${name} is noisy (rms ${f!.rms.toFixed(1)} px).`);
  }

  return {
    objectIds: [a.objectId, b.objectId],
    contactT,
    axis,
    unit: opts.calibration ? "m/s" : "px/s",
    velocities: { a: va, b: vb },
    momentumBefore: pBefore,
    momentumAfter: pAfter,
    momentumRatio: ratio(pAfter, pBefore),
    restitution: ratio(separation, approach),
    energyRatio: ke(va.after.value, vb.after.value) / ke(va.before.value, vb.before.value),
    warnings,
  };
}
