"use client";

import { objectColor } from "@meta-sam/graphics";
import { angleAt, type PendulumResult } from "@/domain/physics/pendulum";
import type { CollisionResult } from "@/domain/physics/collision";
import { formatMeasured, sigmaFrom } from "@/shared/format";
import { Plot, type Series } from "./Plot";

const G = 9.81;
const deg = (rad: number) => (rad * 180) / Math.PI;

function Verdict({ sigma }: { sigma: number }) {
  const a = Math.abs(sigma);
  const tone = a <= 2 ? "good" : a <= 3 ? "warn" : "bad";
  const words = a <= 2 ? "agrees" : a <= 3 ? "is marginal" : "disagrees";
  return (
    <span className={`verdict ${tone}`}>
      {words} ({sigma >= 0 ? "+" : "−"}
      {a.toFixed(1)}σ)
    </span>
  );
}

function Warnings({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="warnings">
      {items.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  );
}

export function PendulumResults({ r }: { r: PendulumResult }) {
  const fitPoints = (() => {
    const t0 = r.series.t[0]!;
    const t1 = r.series.t.at(-1)!;
    return Array.from({ length: 600 }, (_, i) => {
      const t = t0 + ((t1 - t0) * i) / 599;
      return { x: t, y: deg(angleAt(r.angleFit, t)) };
    });
  })();
  const series: Series[] = [
    {
      label: "measured angle",
      color: objectColor(r.objectId),
      style: "dots",
      points: r.series.t.map((t, i) => ({ x: t, y: deg(r.series.theta[i]!) })),
    },
    { label: "fit", color: "var(--fg)", style: "line", points: fitPoints },
  ];
  return (
    <section className="results">
      {r.g ? (
        <p className="headline">
          g = {formatMeasured(r.g, "m/s²")} <Verdict sigma={sigmaFrom(r.g, G)} /> <small>with 9.81</small>
        </p>
      ) : (
        <p className="headline">T = {formatMeasured(r.smallAnglePeriodS, "s")}</p>
      )}
      <dl className="numbers">
        <dt>Period</dt>
        <dd>{formatMeasured(r.periodS, "s")}</dd>
        <dt>Small-swing period</dt>
        <dd>
          {formatMeasured(r.smallAnglePeriodS, "s")}{" "}
          <small>({(r.amplitudeCorrection * 100).toFixed(2)}% correction)</small>
        </dd>
        <dt>Length used</dt>
        <dd>{r.lengthUsedM ? `${formatMeasured(r.lengthUsedM, "m")} (${r.lengthUsedM.source})` : "—"}</dd>
        {r.lengthFromVideoM && r.lengthUsedM?.source === "measured" && (
          <>
            <dt>Length from video</dt>
            <dd>{formatMeasured(r.lengthFromVideoM, "m")}</dd>
          </>
        )}
        <dt>Swing</dt>
        <dd>
          {r.amplitudeDeg.toFixed(1)}°, {r.cycles.toFixed(1)} cycles, damping{" "}
          {Math.abs(r.dampingPerS) < 0.0005 ? "none" : `${r.dampingPerS.toFixed(3)} /s`}
        </dd>
        <dt>Fit residual</dt>
        <dd>
          {r.fitRmsDeg.toFixed(3)}° rms over {r.samplesUsed} frames
        </dd>
      </dl>
      <Plot series={series} xLabel="time (s)" yLabel="angle (°)" />
      <Warnings items={r.warnings} />
    </section>
  );
}

export function CollisionResults({ r }: { r: CollisionResult }) {
  const [ida, idb] = r.objectIds;
  const series: Series[] = (
    [
      ["a", ida],
      ["b", idb],
    ] as const
  ).flatMap(([k, id]) => [
    {
      label: `object ${id}`,
      color: objectColor(id),
      style: "dots" as const,
      points: r.series[k].map((p) => ({ x: p.t, y: p.s })),
    },
    ...r.lines[k].map((l, i) => ({
      label: `${id} fit ${i === 0 ? "before" : "after"}`,
      color: objectColor(id),
      style: "line" as const,
      points: [
        { x: l.from, y: l.slope * l.from + l.intercept },
        { x: l.to, y: l.slope * l.to + l.intercept },
      ],
    })),
  ]);
  const u = r.unit;
  return (
    <section className="results">
      <p className="headline">
        momentum after ÷ before = {formatMeasured(r.momentumRatio)} <Verdict sigma={sigmaFrom(r.momentumRatio, 1)} />
      </p>
      <dl className="numbers">
        <dt>Restitution</dt>
        <dd>{formatMeasured(r.restitution)}</dd>
        <dt>Kinetic energy after ÷ before</dt>
        <dd>{formatMeasured(r.energyRatio)}</dd>
        <dt>Object {ida}</dt>
        <dd>
          {formatMeasured(r.velocities.a.before, u)} → {formatMeasured(r.velocities.a.after, u)}
        </dd>
        <dt>Object {idb}</dt>
        <dd>
          {formatMeasured(r.velocities.b.before, u)} → {formatMeasured(r.velocities.b.after, u)}
        </dd>
        <dt>Contact</dt>
        <dd>{r.contactT.toFixed(3)} s</dd>
      </dl>
      <Plot
        series={series}
        xLabel="time (s)"
        yLabel="position along motion (px)"
        marker={{ x: r.contactT, label: "contact" }}
      />
      <Warnings items={r.warnings} />
    </section>
  );
}
