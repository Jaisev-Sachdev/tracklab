// Small dense linear algebra for least-squares fits (a handful of parameters, so no library needed).

export type Matrix = number[][];

/** Solve A x = b by Gaussian elimination with partial pivoting. Returns undefined if A is singular. */
export function solve(a: Matrix, b: number[]): number[] | undefined {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-300) return undefined;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const p = m[col]!;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const row = m[r]!;
      const f = row[col]! / p[col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) row[c]! -= f * p[c]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** Inverse of a square matrix, or undefined if singular. */
export function invert(a: Matrix): Matrix | undefined {
  const n = a.length;
  const cols: number[][] = [];
  for (let j = 0; j < n; j++) {
    const e = Array.from({ length: n }, (_, i) => (i === j ? 1 : 0));
    const x = solve(a, e);
    if (!x) return undefined;
    cols.push(x);
  }
  return Array.from({ length: n }, (_, i) => cols.map((c) => c[i]!));
}

/** JᵀJ and Jᵀr for a Jacobian given as rows (one row per data point). */
export function normalEquations(jac: number[][], resid: number[]): { jtj: Matrix; jtr: number[] } {
  const p = jac[0]?.length ?? 0;
  const jtj = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const jtr = new Array<number>(p).fill(0);
  jac.forEach((row, k) => {
    for (let i = 0; i < p; i++) {
      jtr[i]! += row[i]! * resid[k]!;
      for (let j = 0; j <= i; j++) jtj[i]![j]! += row[i]! * row[j]!;
    }
  });
  for (let i = 0; i < p; i++) for (let j = 0; j < i; j++) jtj[j]![i] = jtj[i]![j]!;
  return { jtj, jtr };
}
