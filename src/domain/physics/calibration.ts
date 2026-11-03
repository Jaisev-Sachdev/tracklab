// Length scale from a line drawn across an object of known length.
import type { Calibration } from "./types";

export type CalibrationLine = { x1: number; y1: number; x2: number; y2: number };

/**
 * Pixels per metre from a drawn line of known real length. Each end is placed to about `endSePx` pixels and the
 * real length is known to `lengthSeM`, so both feed the uncertainty.
 */
export function calibrationFromLine(
  line: CalibrationLine,
  lengthM: number,
  endSePx = 1.5,
  lengthSeM = 0.001,
): Calibration {
  const px = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
  if (px < 20) throw new Error("Calibration line is too short; draw it across the whole reference object.");
  if (!(lengthM > 0)) throw new Error("Reference length must be positive.");
  const pxPerM = px / lengthM;
  // Two independent end placements add in quadrature along the line.
  const pxSe = Math.SQRT2 * endSePx;
  return { pxPerM, pxPerMSe: pxPerM * Math.hypot(pxSe / px, lengthSeM / lengthM) };
}
