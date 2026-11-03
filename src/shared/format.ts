// Number formatting for measured values, shared by the UI and the agent's tool results.

/** "9.79 ± 0.04": the error to two significant figures, the value to the same decimal place. */
export function formatMeasured(m: { value: number; se: number }, unit = ""): string {
  const suffix = unit ? ` ${unit}` : "";
  if (!Number.isFinite(m.value)) return `—${suffix}`;
  if (!Number.isFinite(m.se) || m.se <= 0) return `${m.value.toPrecision(4)}${suffix}`;
  const decimals = Math.max(0, 1 - Math.floor(Math.log10(m.se)));
  return `${m.value.toFixed(decimals)} ± ${m.se.toFixed(decimals)}${suffix}`;
}

/** How far a measurement is from an expected value, in standard errors. */
export function sigmaFrom(m: { value: number; se: number }, expected: number): number {
  return m.se > 0 ? (m.value - expected) / m.se : Number.POSITIVE_INFINITY;
}
