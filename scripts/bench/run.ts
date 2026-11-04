// Accuracy benchmark, part 2: track every rendered clip with SAM 3.1 (live, billed: about $0.06 per 300 frames),
// run Tracklab's analysis exactly as the app does, and compare with the known truth.
// Writes bench-out/results.json and docs/accuracy.md. Re-runs reuse saved SAM output in bench-out/sam/.
// Usage: npm run bench:run
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildObjectPrompt } from "@meta-sam/parser";
import { calibrationFromLine } from "@/domain/physics/calibration";
import { analyseCollision } from "@/domain/physics/collision";
import { analysePendulum } from "@/domain/physics/pendulum";
import type { Measured } from "@/domain/physics/types";
import { parseVideoText } from "@/domain/track/parse";
import { coverage, tracksFromRecords, type Track } from "@/domain/track/track";
import { formatMeasured, sigmaFrom } from "@/shared/format";
import { readSse } from "@/shared/sse";
import { callResponses } from "@/server/meta";
import { samRequestBody } from "@/server/sam";

type Truth = Record<string, unknown> & {
  id: string;
  kind: string;
  fps: number;
  frames: number;
  width: number;
  height: number;
};
const truth = JSON.parse(readFileSync("bench-out/truth.json", "utf8")) as Truth[];
mkdirSync("bench-out/sam", { recursive: true });

async function samOutput(
  id: string,
  boxes: { id: number; x: number; y: number; r: number }[],
  t: Truth,
): Promise<string> {
  const cache = `bench-out/sam/${id}.txt`;
  if (existsSync(cache)) return readFileSync(cache, "utf8");
  const pad = 3;
  const text = buildObjectPrompt({
    size: { width: t.width, height: t.height },
    objects: boxes.map((b) => ({
      id: b.id,
      prompts: [
        {
          frame: 0,
          box: {
            left: Math.max(0, Math.floor(b.x - b.r - pad)),
            top: Math.max(0, Math.floor(b.y - b.r - pad)),
            right: Math.min(t.width, Math.ceil(b.x + b.r + pad)),
            bottom: Math.min(t.height, Math.ceil(b.y + b.r + pad)),
          },
        },
      ],
    })),
  });
  const video = `data:video/mp4;base64,${readFileSync(`bench-out/${id}.mp4`).toString("base64")}`;
  const res = await callResponses(
    samRequestBody({ kind: "objects", text }, { type: "input_video", video_url: video }, true),
  );
  let out = "";
  for await (const ev of readSse(res.body!)) {
    if (ev.type === "response.output_text.delta") out += String(ev.delta);
    if (ev.type === "response.output_text.done" && !out) out = String(ev.text ?? "");
  }
  writeFileSync(cache, out);
  return out;
}

const within = (m: Measured, truthValue: number) => sigmaFrom(m, truthValue);
const rows: Record<string, unknown>[] = [];

for (const t of truth) {
  const frameTimes = Array.from({ length: t.frames }, (_, i) => i / t.fps);
  try {
    if (t.kind === "pendulum") {
      const start = t.start as { x: number; y: number; r: number };
      const text = await samOutput(t.id, [{ id: 0, ...start }], t);
      const { records } = await parseVideoText(text);
      const [track] = tracksFromRecords(records, { frameTimes, width: t.width, height: t.height }) as Track[];
      const cov = coverage(track!, t.frames);
      const pivot = t.pivot as { x: number; y: number };
      const bar = t.bar as { x1: number; y1: number; x2: number; y2: number };
      const L = t.lengthM as number;
      // Method 1: tape-measured length (truth ± 2 mm). Method 2: pivot + the 0.5 m bar, video only.
      const tape = analysePendulum(track!, { pivot, measuredLengthM: { value: L, se: 0.002 } });
      const video = analysePendulum(track!, { pivot, calibration: calibrationFromLine(bar, 0.5) });
      rows.push({
        id: t.id,
        kind: "pendulum",
        setup: `L = ${L} m, ${t.amplitudeDeg}°, damping ${t.damping}/s, ${t.fps} fps`,
        frames: `${cov.framesTracked}/${t.frames}`,
        gTape: formatMeasured(tape.g!, "m/s²"),
        sigmaTape: within(tape.g!, 9.81),
        errTapePct: (tape.g!.value / 9.81 - 1) * 100,
        gVideo: formatMeasured(video.g!, "m/s²"),
        sigmaVideo: within(video.g!, 9.81),
        errVideoPct: (video.g!.value / 9.81 - 1) * 100,
        warnings: [...new Set([...tape.warnings, ...video.warnings])],
      });
    } else {
      const a = t.startA as { x: number; y: number; r: number };
      const b = t.startB as { x: number; y: number; r: number };
      const text = await samOutput(
        t.id,
        [
          { id: 0, ...a },
          { id: 1, ...b },
        ],
        t,
      );
      const { records } = await parseVideoText(text);
      const tracks = tracksFromRecords(records, { frameTimes, width: t.width, height: t.height });
      const ta = tracks.find((x) => x.objectId === "0")!;
      const tb = tracks.find((x) => x.objectId === "1")!;
      const r = analyseCollision(ta, tb, { massA: t.massA as number, massB: t.massB as number });
      rows.push({
        id: t.id,
        kind: "collision",
        setup: `masses ${t.massA}:${t.massB}, e = ${t.restitution}, ${t.fps} fps`,
        frames: `${coverage(ta, t.frames).framesTracked}/${t.frames}, ${coverage(tb, t.frames).framesTracked}/${t.frames}`,
        momentumRatio: formatMeasured(r.momentumRatio),
        sigmaMomentum: within(r.momentumRatio, 1),
        restitution: formatMeasured(r.restitution),
        sigmaRestitution: within(r.restitution, t.restitution as number),
        restitutionTruth: t.restitution,
        contactErrMs: (r.contactT - (t.contactT as number)) * 1000,
        warnings: r.warnings,
      });
    }
    console.log("done", t.id);
  } catch (e) {
    rows.push({ id: t.id, kind: t.kind, error: e instanceof Error ? e.message : String(e) });
    console.log("FAILED", t.id, e);
  }
}

writeFileSync("bench-out/results.json", JSON.stringify(rows, null, 2));

const s = (v: unknown) => (typeof v === "number" ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}σ` : "—");
const pct = (v: unknown) => (typeof v === "number" ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%` : "—");
const md = [
  "# Accuracy benchmark",
  "",
  "Simulated experiments composited onto real classroom footage (Wikimedia Commons, CC BY-SA 4.0), so the true values",
  "are known exactly. Pendulum motion is integrated numerically from the full nonlinear, damped equation of motion;",
  "everything is rendered at 4× the frame rate and averaged (motion blur), then sensor noise and H.264 compression are",
  "added. SAM 3.1 tracks each clip live from a box on the first frame; Tracklab's analysis runs exactly as in the app.",
  "Regenerate with `npm run bench:render && npm run bench:run`.",
  "",
  "## Pendulums (true g = 9.81 m/s²)",
  "",
  "| Clip | Setup | Frames tracked | g, tape-measured length | vs truth | g, video only (pivot + 0.5 m bar) | vs truth |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...rows
    .filter((r) => r.kind === "pendulum")
    .map((r) =>
      r.error
        ? `| ${r.id} | — | — | failed: ${r.error} | | | |`
        : `| ${r.id} | ${r.setup} | ${r.frames} | ${r.gTape} | ${pct(r.errTapePct)}, ${s(r.sigmaTape)} | ${r.gVideo} | ${pct(r.errVideoPct)}, ${s(r.sigmaVideo)} |`,
    ),
  "",
  "## Collisions (true momentum ratio = 1)",
  "",
  "| Clip | Setup | Frames tracked | Momentum after ÷ before | vs truth | Restitution | vs truth | Contact time error |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ...rows
    .filter((r) => r.kind === "collision")
    .map((r) =>
      r.error
        ? `| ${r.id} | — | — | failed: ${r.error} | | | | |`
        : `| ${r.id} | ${r.setup} | ${r.frames} | ${r.momentumRatio} | ${s(r.sigmaMomentum)} | ${r.restitution} (true ${r.restitutionTruth}) | ${s(r.sigmaRestitution)} | ${(r.contactErrMs as number).toFixed(0)} ms |`,
    ),
  "",
].join("\n");
mkdirSync("docs", { recursive: true });
writeFileSync("docs/accuracy.md", md);
console.log(md);
