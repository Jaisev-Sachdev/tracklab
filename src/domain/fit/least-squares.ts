// Nonlinear least squares (Levenberg–Marquardt) with parameter standard errors.
import { invert, normalEquations, solve } from "./linalg";

export type Model = (params: readonly number[], x: number) => number;

export type FitResult = {
  params: number[];
  /** Standard error of each parameter: sqrt(diag(s² (JᵀJ)⁻¹)), s² = SSR / (n − p). */
  stdErrors: number[];
  /** Root-mean-square residual. */
  rms: number;
  residuals: number[];
  iterations: number;
  converged: boolean;
};

export type FitOptions = { maxIterations?: number; tolerance?: number };

function residualsOf(model: Model, p: readonly number[], xs: readonly number[], ys: readonly number[]): number[] {
  return xs.map((x, i) => ys[i]! - model(p, x));
}

const ssr = (r: readonly number[]) => r.reduce((s, v) => s + v * v, 0);

/** Central-difference Jacobian of the model (not the residual), one row per data point. */
function jacobian(model: Model, p: readonly number[], xs: readonly number[]): number[][] {
  const steps = p.map((v) => 1e-6 * Math.max(Math.abs(v), 1e-3));
  return xs.map((x) =>
    p.map((_, j) => {
      const hi = [...p];
      const lo = [...p];
      hi[j]! += steps[j]!;
      lo[j]! -= steps[j]!;
      return (model(hi, x) - model(lo, x)) / (2 * steps[j]!);
    }),
  );
}

export function levenbergMarquardt(
  model: Model,
  xs: readonly number[],
  ys: readonly number[],
  initial: readonly number[],
  opts: FitOptions = {},
): FitResult {
  const maxIterations = opts.maxIterations ?? 200;
  const tol = opts.tolerance ?? 1e-12;
  let p = [...initial];
  let r = residualsOf(model, p, xs, ys);
  let cost = ssr(r);
  let lambda = 1e-3;
  let converged = false;
  let iterations = 0;

  for (; iterations < maxIterations; iterations++) {
    const { jtj, jtr } = normalEquations(jacobian(model, p, xs), r);
    let improved = false;
    while (lambda < 1e12) {
      const damped = jtj.map((row, i) => row.map((v, j) => (i === j ? v + lambda * (v || 1) : v)));
      const step = solve(damped, jtr);
      if (!step) {
        lambda *= 10;
        continue;
      }
      const candidate = p.map((v, i) => v + step[i]!);
      const rc = residualsOf(model, candidate, xs, ys);
      const cc = ssr(rc);
      if (Number.isFinite(cc) && cc < cost) {
        const relGain = (cost - cc) / Math.max(cost, 1e-300);
        p = candidate;
        r = rc;
        cost = cc;
        lambda = Math.max(lambda / 10, 1e-12);
        improved = true;
        if (relGain < tol) converged = true;
        break;
      }
      lambda *= 10;
    }
    if (!improved) {
      // No step reduces the cost: we are at a minimum (to numerical precision).
      converged = true;
      break;
    }
    if (converged) break;
  }

  const n = xs.length;
  const dof = Math.max(n - p.length, 1);
  const { jtj } = normalEquations(jacobian(model, p, xs), r);
  const cov = invert(jtj);
  const s2 = cost / dof;
  const stdErrors = p.map((_, i) => (cov ? Math.sqrt(Math.max(cov[i]![i]! * s2, 0)) : Number.NaN));
  return { params: p, stdErrors, rms: Math.sqrt(cost / Math.max(n, 1)), residuals: r, iterations, converged };
}

export type LineFit = {
  slope: number;
  intercept: number;
  slopeSe: number;
  interceptSe: number;
  rms: number;
  n: number;
};

/** Ordinary least-squares straight line y = slope·x + intercept. */
export function fitLine(xs: readonly number[], ys: readonly number[]): LineFit {
  const n = xs.length;
  if (n < 2) throw new Error("fitLine needs at least 2 points");
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  xs.forEach((x, i) => {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (ys[i]! - my);
  });
  if (sxx === 0) throw new Error("fitLine needs at least 2 distinct x values");
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const resid = xs.map((x, i) => ys[i]! - (slope * x + intercept));
  const cost = ssr(resid);
  const s2 = n > 2 ? cost / (n - 2) : 0;
  return {
    slope,
    intercept,
    slopeSe: Math.sqrt(s2 / sxx),
    interceptSe: Math.sqrt(s2 * (1 / n + (mx * mx) / sxx)),
    rms: Math.sqrt(cost / n),
    n,
  };
}

export type CircleFit = { cx: number; cy: number; r: number; rSe: number; cxSe: number; cySe: number; rms: number };

/**
 * Circle through points: algebraic (Kåsa) fit for a start, then geometric refinement so distances,
 * not squared distances, are minimised. A short arc constrains r weakly; rSe reports that honestly.
 */
export function fitCircle(xs: readonly number[], ys: readonly number[]): CircleFit {
  const n = xs.length;
  if (n < 3) throw new Error("fitCircle needs at least 3 points");
  // Kåsa: x² + y² + D x + E y + F = 0, linear in D, E, F. Centre the data for conditioning.
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  const rows = xs.map((x, i) => [x - mx, ys[i]! - my, 1]);
  const rhs = xs.map((x, i) => -((x - mx) ** 2 + (ys[i]! - my) ** 2));
  const { jtj, jtr } = normalEquations(rows, rhs);
  const sol = solve(jtj, jtr);
  if (!sol) throw new Error("fitCircle: points are degenerate (collinear or coincident)");
  const [d, e, f] = sol as [number, number, number];
  const start = [mx - d / 2, my - e / 2, Math.sqrt(Math.max((d * d + e * e) / 4 - f, 0))];

  // Geometric refinement: residual of point k is r − |p_k − c|. Index the model by point number.
  const idx = xs.map((_, i) => i);
  const zeros = idx.map(() => 0);
  const fit = levenbergMarquardt((p, k) => p[2]! - Math.hypot(xs[k]! - p[0]!, ys[k]! - p[1]!), idx, zeros, start);
  const [cx, cy, r] = fit.params as [number, number, number];
  return { cx, cy, r, cxSe: fit.stdErrors[0]!, cySe: fit.stdErrors[1]!, rSe: fit.stdErrors[2]!, rms: fit.rms };
}
