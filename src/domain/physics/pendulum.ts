// Pendulum analysis: pivot and length from the bob's arc, period from a damped-sinusoid fit to the angle, then g.
import { fitCircle, levenbergMarquardt } from "../fit/least-squares";
import type { Track } from "../track/track";
import type { Calibration, Measured } from "./types";

export type PendulumOptions = {
  calibration?: Calibration;
  /**
   * Pivot in source pixels (clicked, or found by SAM on a still frame). Strongly preferred: at small swings the arc is
   * nearly straight, so fitting the pivot from the bob's path alone leaves the length very uncertain.
   */
  pivot?: { x: number; y: number; sePx?: number };
  /** Pivot-to-bob-centre length measured by hand, in metres. Used for g instead of the video length if given. */
  measuredLengthM?: Measured;
};

export type PendulumResult = {
  objectId: string;
  samplesUsed: number;
  pivot: { x: number; y: number; source: "given" | "fitted" };
  lengthPx: Measured;
  /** Length from the video (needs calibration) and the length actually used for g. */
  lengthFromVideoM?: Measured;
  lengthUsedM?: Measured & { source: "video" | "measured" };
  /** Measured swing period at the observed amplitude, corrected for damping. */
  periodS: Measured;
  /** Period extrapolated to small swings: T / (1 + θ²/16). */
  smallAnglePeriodS: Measured;
  amplitudeDeg: number;
  /** Fractional period correction applied for amplitude, e.g. 0.0019 for 10°. */
  amplitudeCorrection: number;
  dampingPerS: number;
  cycles: number;
  fitRmsDeg: number;
  g?: Measured;
  /** For plotting: the measured angle (rad) per sample and the fitted curve's parameters (see `angleAt`). */
  series: { t: number[]; theta: number[] };
  angleFit: AngleFit;
  warnings: string[];
};

/** θ(t) = a·e^(−γ·(t − t0))·cos(ω·(t − t0) + φ) + c */
export type AngleFit = { a: number; gamma: number; omega: number; phi: number; c: number; t0: number };

export const angleAt = (f: AngleFit, t: number) =>
  f.a * Math.exp(-f.gamma * (t - f.t0)) * Math.cos(f.omega * (t - f.t0) + f.phi) + f.c;

const deg = (rad: number) => (rad * 180) / Math.PI;

/** Times where the signal crosses zero, by linear interpolation between samples. */
function zeroCrossings(ts: readonly number[], vs: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < vs.length; i++) {
    const a = vs[i - 1]!;
    const b = vs[i]!;
    if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) out.push(ts[i - 1]! + ((ts[i]! - ts[i - 1]!) * a) / (a - b));
  }
  return out;
}

/** θ(t) = A·e^(−γ·τ)·cos(ω·τ + φ) + c, with τ = t − t0. Params: [A, γ, ω, φ, c]. */
const dampedCosine = (t0: number) => (p: readonly number[], t: number) =>
  p[0]! * Math.exp(-p[1]! * (t - t0)) * Math.cos(p[2]! * (t - t0) + p[3]!) + p[4]!;

export function analysePendulum(track: Track, opts: PendulumOptions = {}): PendulumResult {
  const warnings: string[] = [];
  const samples = track.samples.filter((s) => !s.clipped);
  const dropped = track.samples.length - samples.length;
  if (dropped > 0) warnings.push(`Dropped ${dropped} frames where the bob touched the frame edge.`);
  if (samples.length < 20) throw new Error(`Too few usable frames (${samples.length}) to analyse a pendulum.`);

  // Pivot and length. With a given pivot, every frame measures the length directly. Otherwise the bob's centre moves
  // on a circle around the pivot, which a short arc constrains only weakly.
  let pivot: PendulumResult["pivot"];
  let lengthPx: Measured;
  if (opts.pivot) {
    const { x, y, sePx = 1.5 } = opts.pivot;
    const d = samples.map((s) => Math.hypot(s.x - x, s.y - y));
    const mean = d.reduce((s, v) => s + v, 0) / d.length;
    const sd = Math.sqrt(d.reduce((s, v) => s + (v - mean) ** 2, 0) / (d.length - 1));
    pivot = { x, y, source: "given" };
    lengthPx = { value: mean, se: Math.hypot(sd / Math.sqrt(d.length), sePx) };
  } else {
    const circle = fitCircle(
      samples.map((s) => s.x),
      samples.map((s) => s.y),
    );
    // Good enough for angles (the period barely depends on the pivot), but not for length: on SAM's output for a
    // 10° swing the fitted length came out 14% long while claiming ±2%. Pixel bias, not noise, dominates a short arc.
    pivot = { x: circle.cx, y: circle.cy, source: "fitted" };
    lengthPx = { value: circle.r, se: circle.rSe };
  }
  const ts = samples.map((s) => s.t);
  // Angle from vertical; image y points down, so a bob below the pivot has dy > 0.
  const theta = samples.map((s) => Math.atan2(s.x - pivot.x, s.y - pivot.y));

  // Initial guesses from the raw angle series.
  const mean = theta.reduce((s, v) => s + v, 0) / theta.length;
  const centred = theta.map((v) => v - mean);
  const crossings = zeroCrossings(ts, centred);
  if (crossings.length < 3)
    throw new Error("The bob doesn't swing through the centre at least twice; is it a pendulum?");
  const halfPeriod = (crossings.at(-1)! - crossings[0]!) / (crossings.length - 1);
  const omega0 = Math.PI / halfPeriod;
  const amp0 = (Math.max(...centred) - Math.min(...centred)) / 2;
  const t0 = ts[0]!;

  // The phase guess matters for convergence: try four and keep the best.
  const model = dampedCosine(t0);
  const fit = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
    .map((phi) => levenbergMarquardt(model, ts, theta, [amp0, 0, omega0, phi, mean]))
    .reduce((best, f) => (f.rms < best.rms ? f : best));
  const [a, gamma, omega, phi, c] = fit.params as [number, number, number, number, number];
  const omegaSe = fit.stdErrors[2]!;

  // Undamped angular frequency, then the amplitude correction at the mean amplitude over the clip.
  const omegaNat = Math.sqrt(omega * omega + gamma * gamma);
  const duration = ts.at(-1)! - t0;
  const meanAmp =
    Math.abs(gamma) * duration > 1e-9
      ? (Math.abs(a) * (1 - Math.exp(-gamma * duration))) / (gamma * duration)
      : Math.abs(a);
  const correction = (meanAmp * meanAmp) / 16;
  const period = (2 * Math.PI) / omegaNat;
  // ω and −ω describe the same cosine, so use |ω|.
  const periodSe = (period * omegaSe) / Math.abs(omega);
  const small = period / (1 + correction);
  const smallSe = periodSe / (1 + correction);
  const cycles = duration / period;

  const result: PendulumResult = {
    objectId: track.objectId,
    samplesUsed: samples.length,
    pivot,
    lengthPx,
    periodS: { value: period, se: periodSe },
    smallAnglePeriodS: { value: small, se: smallSe },
    amplitudeDeg: deg(meanAmp),
    amplitudeCorrection: correction,
    dampingPerS: gamma,
    cycles,
    fitRmsDeg: deg(fit.rms),
    series: { t: ts, theta },
    angleFit: { a, gamma, omega, phi, c, t0 },
    warnings,
  };

  if (opts.calibration && pivot.source === "given") {
    const { pxPerM, pxPerMSe } = opts.calibration;
    const value = lengthPx.value / pxPerM;
    result.lengthFromVideoM = { value, se: value * Math.hypot(lengthPx.se / lengthPx.value, pxPerMSe / pxPerM) };
  }
  if (opts.measuredLengthM) result.lengthUsedM = { ...opts.measuredLengthM, source: "measured" };
  else if (result.lengthFromVideoM) result.lengthUsedM = { ...result.lengthFromVideoM, source: "video" };

  if (result.lengthUsedM) {
    const L = result.lengthUsedM;
    const g = (4 * Math.PI * Math.PI * L.value) / (small * small);
    result.g = { value: g, se: g * Math.hypot(L.se / L.value, (2 * smallSe) / small) };
  } else if (opts.calibration) {
    warnings.push(
      "The pivot wasn't marked, so the length can't be read from the video. Mark the pivot or measure the length by hand to get g.",
    );
  } else {
    warnings.push("No length scale: mark the pivot and set a calibration line, or enter a measured length, to get g.");
  }

  if (cycles < 3) warnings.push(`Only ${cycles.toFixed(1)} swings filmed; 5 or more give a tighter period.`);
  if (deg(meanAmp) > 20) {
    warnings.push(
      `Large swing (${deg(meanAmp).toFixed(0)}°): the amplitude correction (${(correction * 100).toFixed(1)}%) is less exact above about 20°. Release from below 15°.`,
    );
  }
  if (fit.rms > 0.05 * Math.abs(a)) {
    warnings.push(`The swing doesn't fit a clean pendulum well (rms ${deg(fit.rms).toFixed(2)}°); check the tracking.`);
  }
  if (!fit.converged) warnings.push("The period fit did not fully converge.");
  return result;
}
