// Accuracy benchmark, part 1: composite simulated experiments onto real classroom footage, with known truth.
// Motion comes from numerically integrated physics (RK4 for the pendulum), not from the formulas the analysis
// inverts, and is rendered at 4x the output frame rate then averaged, so moving objects get real motion blur.
// Then sensor noise and lossy compression. Writes bench-out/<id>.mp4 and bench-out/truth.json.
// Usage: npm run bench:render   (needs footage-src/pendelgesetz.webm and footage-src/fadenpendel.webm)
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import ffmpegPath from "ffmpeg-static";

const OUT = "bench-out";
const W = 1280;
const H = 720;
const SUB = 4; // sub-frames per output frame, averaged into motion blur
const G = 9.81;

function ffmpeg(args: string[]): void {
  const r = spawnSync(ffmpegPath as unknown as string, ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg exited with ${r.status}`);
}

/** A shaded ball sprite of radius r (diffuse falloff plus a highlight). */
const ball = (r: number, [cr, cg, cb]: [number, number, number]) => {
  const d = `hypot(X-${r},Y-${r})/${r}`;
  const shade = `(1-0.45*${d})+0.35*exp(-(pow(X-${r * 0.65},2)+pow(Y-${r * 0.6},2))/${(r * 0.35) ** 2})`;
  return (
    `color=c=black:s=${2 * r}x${2 * r},format=rgba,` +
    `geq=r='min(255,${cr}*${shade})':g='min(255,${cg}*${shade})':b='min(255,${cb}*${shade})':a='if(lte(${d},1),255,0)'`
  );
};

type Pos = { x: number; y: number };

/** sendcmd script moving overlay instances; one line per sub-frame time. */
function sendcmd(names: string[], paths: Pos[][], r: number[], fps: number): string {
  const n = paths[0]!.length;
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (fps * SUB)).toFixed(6);
    const cmds = names.map((name, k) => {
      const p = paths[k]![i]!;
      return `${name} x ${(p.x - r[k]!).toFixed(2)}, ${name} y ${(p.y - r[k]!).toFixed(2)}`;
    });
    lines.push(`${t} ${cmds.join(", ")};`);
  }
  return lines.join("\n");
}

function render(opts: {
  id: string;
  background: { file: string; start: number };
  seconds: number;
  fps: number;
  balls: { r: number; color: [number, number, number]; path: Pos[] }[];
  extras: string[];
  noise: number;
}): void {
  const { id, seconds, fps } = opts;
  const cmdFile = `${OUT}/${id}.cmd`;
  writeFileSync(
    cmdFile,
    sendcmd(
      opts.balls.map((_, k) => `overlay@b${k}`),
      opts.balls.map((b) => b.path),
      opts.balls.map((b) => b.r),
      fps,
    ),
  );
  const sprites = opts.balls.map((b, k) => `${ball(b.r, b.color)}[s${k}]`);
  let chain = `[0:v]scale=${W}:${H},fps=${fps * SUB},sendcmd=f='${cmdFile.replace(/\\/g, "/")}'[bg0]`;
  opts.balls.forEach((b, k) => {
    chain += `;[bg${k}][s${k}]overlay@b${k}=x=${b.path[0]!.x - b.r}:y=${b.path[0]!.y - b.r}[bg${k + 1}]`;
  });
  const last = `bg${opts.balls.length}`;
  const extras = opts.extras.length ? `,${opts.extras.join(",")}` : "";
  chain += `;[${last}]tmix=frames=${SUB},fps=${fps}${extras},noise=alls=${opts.noise}:allf=t,format=yuv420p[v]`;
  ffmpeg([
    "-ss",
    String(opts.background.start),
    "-stream_loop",
    "-1",
    "-i",
    opts.background.file,
    "-filter_complex",
    [...sprites, chain].join(";"),
    "-map",
    "[v]",
    "-t",
    String(seconds),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "26",
    "-r",
    String(fps),
    "-movflags",
    "+faststart",
    `${OUT}/${id}.mp4`,
  ]);
}

/** Damped nonlinear pendulum θ'' = −(g/L)·sin θ − 2γ·θ', RK4, sampled every `dt`. */
function pendulumAngles(L: number, theta0: number, gamma: number, dt: number, n: number): number[] {
  const f = (th: number, w: number) => [w, -(G / L) * Math.sin(th) - 2 * gamma * w] as const;
  const steps = 20;
  const h = dt / steps;
  let th = theta0;
  let w = 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(th);
    for (let s = 0; s < steps; s++) {
      const k1 = f(th, w);
      const k2 = f(th + (h / 2) * k1[0], w + (h / 2) * k1[1]);
      const k3 = f(th + (h / 2) * k2[0], w + (h / 2) * k2[1]);
      const k4 = f(th + h * k3[0], w + h * k3[1]);
      th += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      w += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    }
  }
  return out;
}

mkdirSync(OUT, { recursive: true });
const truth: Record<string, unknown>[] = [];

// Pendulums over the classroom board (its own real pendulum, captions and the teacher are distractions).
const PX_PER_M = 700;
const pendulums = [
  { L: 0.35, deg: 8, gamma: 0, fps: 30, color: [230, 70, 60] },
  { L: 0.5, deg: 12, gamma: 0.02, fps: 30, color: [240, 200, 40] },
  { L: 0.65, deg: 6, gamma: 0.04, fps: 60, color: [80, 160, 240] },
  { L: 0.8, deg: 15, gamma: 0.01, fps: 30, color: [240, 120, 200] },
  { L: 0.45, deg: 20, gamma: 0.03, fps: 60, color: [90, 220, 120] },
  { L: 0.7, deg: 10, gamma: 0, fps: 25, color: [250, 150, 50] },
] as const;
pendulums.forEach((p, i) => {
  const id = `bench-pendulum-${i + 1}`;
  const seconds = 12;
  const pivot = { x: 900, y: 70 };
  const Lpx = p.L * PX_PER_M;
  const n = seconds * p.fps * SUB;
  const angles = pendulumAngles(p.L, (p.deg * Math.PI) / 180, p.gamma, 1 / (p.fps * SUB), n);
  const path = angles.map((th) => ({ x: pivot.x + Lpx * Math.sin(th), y: pivot.y + Lpx * Math.cos(th) }));
  // A 0.5 m reference bar for the video-scale method, and the pivot as a small dark dot.
  const bar = { x1: 760, y1: 690, x2: 760 + 0.5 * PX_PER_M, y2: 690 };
  render({
    id,
    background: { file: "footage-src/pendelgesetz.webm", start: 5 + 0.5 * i },
    seconds,
    fps: p.fps,
    balls: [{ r: 16, color: [...p.color] as [number, number, number], path }],
    extras: [
      `drawbox=x=${pivot.x - 5}:y=${pivot.y - 5}:w=10:h=10:color=0x202020:t=fill`,
      `drawbox=x=${bar.x1}:y=${bar.y1 - 4}:w=${bar.x2 - bar.x1}:h=8:color=0xf0f0f0:t=fill`,
    ],
    noise: 7,
  });
  truth.push({
    id,
    kind: "pendulum",
    fps: p.fps,
    frames: seconds * p.fps,
    width: W,
    height: H,
    g: G,
    lengthM: p.L,
    amplitudeDeg: p.deg,
    damping: p.gamma,
    pxPerM: PX_PER_M,
    pivot,
    bar,
    start: { x: path[0]!.x, y: path[0]!.y, r: 16 },
  });
});

// Collisions over the real room footage: 1-D along a slightly tilted line, known masses and restitution.
const collisions = [
  { ma: 1, mb: 1, e: 1, va: 260, vb: -180, fps: 30 },
  { ma: 2, mb: 1, e: 0.6, va: 220, vb: 0, fps: 60 },
  { ma: 1, mb: 3, e: 0.3, va: 300, vb: -60, fps: 30 },
  { ma: 1.5, mb: 1, e: 0, va: 200, vb: -100, fps: 60 },
] as const;
collisions.forEach((c, i) => {
  const id = `bench-collision-${i + 1}`;
  const seconds = 4;
  const ra = Math.round(18 * Math.cbrt(c.ma));
  const rb = Math.round(18 * Math.cbrt(c.mb));
  const angle = (4 * Math.PI) / 180;
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const tHit = 1.8;
  // After: v_a' = (m_a v_a + m_b v_b − m_b e (v_a − v_b)) / (m_a + m_b), and similarly for b.
  const M = c.ma + c.mb;
  const p = c.ma * c.va + c.mb * c.vb;
  const vaAfter = (p - c.mb * c.e * (c.va - c.vb)) / M;
  const vbAfter = (p + c.ma * c.e * (c.va - c.vb)) / M;
  const centre = { x: 640, y: 560 };
  const sHitA = -ra;
  const sHitB = rb;
  const n = seconds * c.fps * SUB;
  const along = (s: number) => ({ x: centre.x + s * dir.x, y: centre.y + s * dir.y });
  const pathA: Pos[] = [];
  const pathB: Pos[] = [];
  for (let k = 0; k < n; k++) {
    const t = k / (c.fps * SUB) - tHit;
    pathA.push(along(sHitA + (t < 0 ? c.va : vaAfter) * t));
    pathB.push(along(sHitB + (t < 0 ? c.vb : vbAfter) * t));
  }
  render({
    id,
    background: { file: "footage-src/fadenpendel.webm", start: 8.5 },
    seconds,
    fps: c.fps,
    balls: [
      { r: ra, color: [220, 60, 50], path: pathA },
      { r: rb, color: [50, 110, 220], path: pathB },
    ],
    extras: [],
    noise: 7,
  });
  truth.push({
    id,
    kind: "collision",
    fps: c.fps,
    frames: seconds * c.fps,
    width: W,
    height: H,
    massA: c.ma,
    massB: c.mb,
    restitution: c.e,
    velocities: { a: [c.va, vaAfter], b: [c.vb, vbAfter] },
    contactT: tHit,
    startA: { ...pathA[0]!, r: ra },
    startB: { ...pathB[0]!, r: rb },
  });
});

writeFileSync(`${OUT}/truth.json`, JSON.stringify(truth, null, 2));
console.log(`Rendered ${truth.length} clips to ${OUT}/`);
