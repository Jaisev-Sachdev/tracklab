// 1-D collision analysis: velocities just before and after contact, momentum, restitution and energy.
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
  energyRatio: Measured;
  warnings: string[];
};

type Point = { t: number; s: number };

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

/** Straight-line fit to the points with from <= t <= to, or undefined with fewer than 4. */
function lineIn(points: readonly Point[], from: number, to: number): LineFit | undefined {
  const inside = points.filter((p) => p.t >= from && p.t <= to);
  if (inside.length < 4) return undefined;
  return fitLine(
    inside.map((p) => p.t),
    inside.map((p) => p.s),
  );
}

const ssr = (f: LineFit) => f.rms * f.rms * f.n;
const at = (f: LineFit, t: number) => f.slope * t + f.intercept;

/**
 * Contact time as the breakpoint where splitting both objects' positions into one straight line before and another
 * after explains them best, compared with a single line through the same window. (Comparing raw residuals alone
 * would let any window that misses the collision win with two perfect lines.) Unlike "closest approach", this doesn't
 * drift early on slow approaches or depend on object size.
 */
function findContact(a: readonly Point[], b: readonly Point[], span: number): number | undefined {
  let best: { t: number; gain: number } | undefined;
  for (const { t } of a) {
    let gain = 0;
    let ok = true;
    for (const pts of [a, b]) {
      const before = lineIn(
        pts.filter((p) => p.t < t),
        t - span,
        t,
      );
      const after = lineIn(pts, t, t + span);
      const single = lineIn(pts, t - span, t + span);
      if (!before || !after || !single) {
        ok = false;
        break;
      }
      gain += ssr(single) - ssr(before) - ssr(after);
    }
    if (ok && (!best || gain > best.gain)) best = { t, gain };
  }
  return best?.t;
}

/** num / den, propagating independent errors; safe when num is zero. */
const ratio = (num: Measured, den: Measured): Measured => {
  const value = num.value / den.value;
  return { value, se: Math.abs(Math.hypot(num.se, value * den.se) / den.value) };
};

export function analyseCollision(a: Track, b: Track, opts: CollisionOptions): CollisionResult {
  const warnings: string[] = [];
  const exclude = opts.excludeS ?? 0.1;
  const span = opts.fitWindowS ?? 0.6;
  const { massA: ma, massB: mb } = opts;

  const usable = (t: Track) => t.samples.filter((s: Sample) => !s.clipped);
  const axis = principalAxis([...usable(a), ...usable(b)]);
  const project = (t: Track): Point[] => usable(t).map((s) => ({ t: s.t, s: s.x * axis.x + s.y * axis.y }));
  const pa = project(a);
  const pb = project(b);
  if (pa.length < 8 || pb.length < 8) throw new Error("Too few clean frames of one of the objects to analyse.");

  const contactT = findContact(pa, pb, span);
  if (contactT === undefined) {
    throw new Error("Not enough clean frames either side of any collision moment. Film longer before and after.");
  }

  const fit = (pts: Point[], before: boolean) =>
    before
      ? lineIn(pts, contactT - exclude - span, contactT - exclude)
      : lineIn(pts, contactT + exclude, contactT + exclude + span);
  const fits = { aBefore: fit(pa, true), aAfter: fit(pa, false), bBefore: fit(pb, true), bAfter: fit(pb, false) };
  const missing = Object.entries(fits)
    .filter(([, f]) => !f)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(
      `Not enough clean frames near the collision for: ${missing.join(", ")}. Film longer before and after.`,
    );
  }
  const { aBefore, bBefore } = fits as Record<keyof typeof fits, LineFit>;
  let { aAfter, bAfter } = fits as Record<keyof typeof fits, LineFit>;

  // Each object's path should be continuous through contact. If the "after" lines join up better swapped, SAM
  // swapped the ids at contact: swap them back rather than report a confident nonsense restitution of about -1.
  const gap = (x: LineFit, y: LineFit) => Math.abs(at(x, contactT) - at(y, contactT));
  const straight = gap(aBefore, aAfter) + gap(bBefore, bAfter);
  const swapped = gap(aBefore, bAfter) + gap(bBefore, aAfter);
  if (straight > Math.max(10, 3 * swapped)) {
    [aAfter, bAfter] = [bAfter, aAfter];
    warnings.push("The tracker swapped the two objects' ids at contact; Tracklab swapped them back.");
  } else if (straight > 20) {
    warnings.push(`The tracks jump by ${straight.toFixed(0)} px at contact; check the tracking around the collision.`);
  }

  // A collision changes at least one velocity; without that, the "contact" found is just noise on straight motion.
  const changed = (x: LineFit, y: LineFit) =>
    Math.abs(y.slope - x.slope) >
    Math.max(5 * Math.hypot(x.slopeSe, y.slopeSe), 0.05 * Math.max(Math.abs(x.slope), Math.abs(y.slope), 1));
  if (!changed(aBefore, aAfter) && !changed(bBefore, bAfter)) {
    throw new Error("Neither object changes speed in the video, so there's no collision to analyse.");
  }

  // Ratios are computed in pixels, where the length scale cancels exactly; only absolute values carry its error.
  const px = (f: LineFit): Measured => ({ value: f.slope, se: f.slopeSe });
  const va = { before: px(aBefore), after: px(aAfter) };
  const vb = { before: px(bBefore), after: px(bAfter) };
  const momentum = (x: Measured, y: Measured): Measured => ({
    value: ma * x.value + mb * y.value,
    se: Math.hypot(ma * x.se, mb * y.se),
  });
  const pBefore = momentum(va.before, vb.before);
  const pAfter = momentum(va.after, vb.after);
  const approach = { value: va.before.value - vb.before.value, se: Math.hypot(va.before.se, vb.before.se) };
  const separation = { value: vb.after.value - va.after.value, se: Math.hypot(va.after.se, vb.after.se) };
  const kinetic = (x: Measured, y: Measured): Measured => ({
    value: ma * x.value ** 2 + mb * y.value ** 2,
    // d(m v²)/dv = 2 m v
    se: Math.hypot(2 * ma * x.value * x.se, 2 * mb * y.value * y.se),
  });

  const scale = opts.calibration?.pxPerM ?? 1;
  const scaleRel = opts.calibration ? opts.calibration.pxPerMSe / opts.calibration.pxPerM : 0;
  // One length scale multiplies every absolute value, so its error is one correlated term on each.
  const absolute = (m: Measured): Measured => {
    const value = m.value / scale;
    return { value, se: Math.hypot(m.se / scale, value * scaleRel) };
  };

  if (Math.abs(pBefore.value) < 3 * pBefore.se) {
    warnings.push("Total momentum before the collision is close to zero, so the conservation ratio is unstable.");
  }
  if (Math.abs(approach.value) < 3 * approach.se) {
    warnings.push("The objects were hardly closing on each other, so the restitution is unstable.");
  }
  const restitution = ratio(separation, approach);
  if (restitution.value < -3 * restitution.se) {
    warnings.push("Negative restitution: the objects pass through each other, which suggests a tracking error.");
  }
  for (const [name, f] of Object.entries({ aBefore, aAfter, bBefore, bAfter })) {
    if (f.rms > Math.max(2, 0.05 * Math.abs(f.slope) * span)) {
      warnings.push(`Velocity fit ${name} is noisy (rms ${f.rms.toFixed(1)} px).`);
    }
  }

  return {
    objectIds: [a.objectId, b.objectId],
    contactT,
    axis,
    unit: opts.calibration ? "m/s" : "px/s",
    velocities: {
      a: { before: absolute(va.before), after: absolute(va.after) },
      b: { before: absolute(vb.before), after: absolute(vb.after) },
    },
    momentumBefore: absolute(pBefore),
    momentumAfter: absolute(pAfter),
    momentumRatio: ratio(pAfter, pBefore),
    restitution,
    energyRatio: ratio(kinetic(va.after, vb.after), kinetic(va.before, vb.before)),
    warnings,
  };
}
