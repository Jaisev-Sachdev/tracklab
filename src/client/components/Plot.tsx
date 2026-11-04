// Minimal SVG line/scatter plot for measured series and fitted curves; no charting library.

export type Series = {
  label: string;
  color: string;
  points: { x: number; y: number }[];
  /** "dots" for measurements, "line" for fits. */
  style: "dots" | "line";
};

type Props = { series: Series[]; xLabel: string; yLabel: string; marker?: { x: number; label: string } };

const W = 640;
const H = 240;
const PAD = { left: 52, right: 12, top: 12, bottom: 34 };

function ticks(min: number, max: number, count: number): number[] {
  const span = max - min || 1;
  const step = 10 ** Math.floor(Math.log10(span / count));
  const nice = [1, 2, 5, 10].map((m) => m * step).find((s) => span / s <= count) ?? step * 10;
  const out: number[] = [];
  for (let v = Math.ceil(min / nice) * nice; v <= max + 1e-9; v += nice) out.push(Number(v.toPrecision(12)));
  return out;
}

export function Plot({ series, xLabel, yLabel, marker }: Props) {
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return null;
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const yPad = (Math.max(...ys) - Math.min(...ys)) * 0.08 || 1;
  const [y0, y1] = [Math.min(...ys) - yPad, Math.max(...ys) + yPad];
  const sx = (x: number) => PAD.left + ((x - x0) / (x1 - x0 || 1)) * (W - PAD.left - PAD.right);
  const sy = (y: number) => H - PAD.bottom - ((y - y0) / (y1 - y0 || 1)) * (H - PAD.top - PAD.bottom);

  return (
    <figure className="plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} against ${xLabel}`}>
        {ticks(y0, y1, 5).map((v) => (
          <g key={`y${v}`}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={sy(v)} y2={sy(v)} />
            <text className="tick" x={PAD.left - 6} y={sy(v)} textAnchor="end" dominantBaseline="middle">
              {v}
            </text>
          </g>
        ))}
        {ticks(x0, x1, 8).map((v) => (
          <text key={`x${v}`} className="tick" x={sx(v)} y={H - PAD.bottom + 14} textAnchor="middle">
            {v}
          </text>
        ))}
        <text className="axis-label" x={(PAD.left + W - PAD.right) / 2} y={H - 4} textAnchor="middle">
          {xLabel}
        </text>
        <text
          className="axis-label"
          transform={`translate(12 ${(PAD.top + H - PAD.bottom) / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          {yLabel}
        </text>
        {marker && (
          <g>
            <line className="marker" x1={sx(marker.x)} x2={sx(marker.x)} y1={PAD.top} y2={H - PAD.bottom} />
            <text className="tick" x={sx(marker.x) + 4} y={PAD.top + 10}>
              {marker.label}
            </text>
          </g>
        )}
        {/* Fits first, measurements on top, so the data stays visible where a good fit runs through it. */}
        {series
          .filter((s) => s.style === "line")
          .map((s) => (
            <polyline
              key={s.label}
              fill="none"
              stroke={s.color}
              style={{ color: s.color }}
              strokeWidth={1.6}
              opacity={0.85}
              points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}
            />
          ))}
        {series
          .filter((s) => s.style === "dots")
          .map((s) => (
            <g key={s.label} fill={s.color}>
              {s.points.map((p, i) => (
                <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={2.2} />
              ))}
            </g>
          ))}
      </svg>
      <figcaption className="legend">
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
