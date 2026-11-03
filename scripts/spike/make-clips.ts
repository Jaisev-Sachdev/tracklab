// Spike: render synthetic clips with known physics, so SAM output can be checked against ground truth.
// Writes spike-out/pendulum.mp4, spike-out/collision.mp4 and spike-out/truth.json.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import ffmpegPath from "ffmpeg-static";

const OUT = "spike-out";
const W = 1280;
const H = 720;
const FPS = 30;
const R = 30; // ball radius, px

// Pendulum: pivot (640, 100), length 400 px, 800 px/m scale => L = 0.5 m.
// Period includes the finite-amplitude correction, so an analysis that applies it recovers g = 9.81.
const G = 9.81;
const PX_PER_M = 800;
const L_PX = 400;
const L_M = L_PX / PX_PER_M;
const THETA0 = (10 * Math.PI) / 180;
const T0 = 2 * Math.PI * Math.sqrt(L_M / G);
const T = T0 * (1 + THETA0 ** 2 / 16);
const PIVOT = { x: 640, y: 100 };

// Collision: equal masses, elastic, so velocities swap at contact.
const A0 = 200;
const B0 = 1000;
const VA = 300;
const VB = -200;
const T_HIT = (B0 - A0 - 2 * R) / (VA - VB);
const XA_HIT = A0 + VA * T_HIT;
const XB_HIT = B0 + VB * T_HIT;

function ffmpeg(args: string[]): void {
  if (!ffmpegPath) throw new Error("ffmpeg-static has no binary for this platform");
  const r = spawnSync(ffmpegPath as unknown as string, ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg exited with ${r.status}`);
}

const ball = (color: string) =>
  `format=rgba,geq=r='${parseInt(color.slice(0, 2), 16)}':g='${parseInt(color.slice(2, 4), 16)}':b='${parseInt(color.slice(4, 6), 16)}':a='if(lte(hypot(X-${R - 0.5},Y-${R - 0.5}),${R}),255,0)'`;

const encode = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(FPS), "-movflags", "+faststart"];
const bg = (d: number) => ["-f", "lavfi", "-i", `color=c=0xf2efe6:s=${W}x${H}:r=${FPS}:d=${d}`];
const sprite = (d: number) => ["-f", "lavfi", "-i", `color=c=black:s=${2 * R}x${2 * R}:r=${FPS}:d=${d}`];

mkdirSync(OUT, { recursive: true });

const theta = `${THETA0}*cos(2*PI*t/${T})`;
ffmpeg([
  ...bg(10),
  ...sprite(10),
  "-filter_complex",
  [
    `[1:v]${ball("d23c3c")}[bob]`,
    `[0:v][bob]overlay=x='${PIVOT.x}+${L_PX}*sin(${theta})-${R}':y='${PIVOT.y}+${L_PX}*cos(${theta})-${R}':eval=frame,` +
      `drawbox=x=${PIVOT.x - 6}:y=${PIVOT.y - 6}:w=12:h=12:color=black:t=fill,` +
      `drawbox=x=440:y=680:w=${L_PX}:h=10:color=black:t=fill[v]`,
  ].join(";"),
  "-map",
  "[v]",
  ...encode,
  `${OUT}/pendulum.mp4`,
]);

const xa = `if(lt(t,${T_HIT}),${A0}+${VA}*t,${XA_HIT}+${VB}*(t-${T_HIT}))`;
const xb = `if(lt(t,${T_HIT}),${B0}+${VB}*t,${XB_HIT}+${VA}*(t-${T_HIT}))`;
ffmpeg([
  ...bg(4),
  ...sprite(4),
  ...sprite(4),
  "-filter_complex",
  [
    `[1:v]${ball("2f5fd0")}[a]`,
    `[2:v]${ball("2f5fd0")}[b]`,
    `[0:v][a]overlay=x='${xa}-${R}':y=${360 - R}:eval=frame[va]`,
    `[va][b]overlay=x='${xb}-${R}':y=${360 - R}:eval=frame[v]`,
  ].join(";"),
  "-map",
  "[v]",
  ...encode,
  `${OUT}/collision.mp4`,
]);

writeFileSync(
  `${OUT}/truth.json`,
  JSON.stringify(
    {
      fps: FPS,
      pendulum: {
        g: G,
        pxPerM: PX_PER_M,
        lengthPx: L_PX,
        lengthM: L_M,
        theta0Rad: THETA0,
        periodS: T,
        pivot: PIVOT,
        radiusPx: R,
      },
      collision: { radiusPx: R, y: 360, a: { x0: A0, v: VA }, b: { x0: B0, v: VB }, tHit: T_HIT },
    },
    null,
    2,
  ),
);
console.log(
  `Wrote ${OUT}/pendulum.mp4 (T = ${T.toFixed(5)} s), ${OUT}/collision.mp4 (contact at ${T_HIT.toFixed(3)} s), ${OUT}/truth.json`,
);
