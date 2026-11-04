// The Tracklab mark: a stroboscopic pendulum, the bob caught at several moments along its swing.
export function Logo({ size = 40 }: { size?: number }) {
  const pivot = { x: 24, y: 5 };
  const L = 34;
  const angles = [-0.62, -0.38, -0.14, 0.12, 0.36];
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="logo">
      {angles.map((a, i) => {
        const x = pivot.x + L * Math.sin(a);
        const y = pivot.y + L * Math.cos(a);
        const last = i === angles.length - 1;
        return (
          <g key={a} opacity={last ? 1 : 0.18 + i * 0.14}>
            {last && <line x1={pivot.x} y1={pivot.y} x2={x} y2={y} stroke="var(--fg)" strokeWidth={1.6} />}
            <circle cx={x} cy={y} r={last ? 5.2 : 3.6} fill={last ? "var(--signal)" : "var(--trace)"} />
          </g>
        );
      })}
      <circle cx={pivot.x} cy={pivot.y} r={2.4} fill="var(--fg)" />
    </svg>
  );
}
