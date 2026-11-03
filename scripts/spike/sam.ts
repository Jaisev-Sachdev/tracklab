// Spike: run SAM 3.1 on the synthetic clips and compare box centres with ground truth.
// Usage: npm run spike:sam -- [pendulum|collision] [--data-url]
// Saves raw output to spike-out/sam-<clip>.txt for inspecting the line and mask format.
import { readFileSync, writeFileSync } from "node:fs";
import { dataUrl, streamResponse, uploadFile } from "./meta.ts";

const clip = process.argv[2] === "collision" ? "collision" : "pendulum";
const useDataUrl = process.argv.includes("--data-url");
const promptArg = process.argv.indexOf("--prompt");
const prompt = promptArg > -1 ? process.argv[promptArg + 1]! : clip === "pendulum" ? "red ball" : "blue ball";
const path = `spike-out/${clip}.mp4`;
const truth = JSON.parse(readFileSync("spike-out/truth.json", "utf8"));

type Rec = { frame: number; id: number; x1: number; y1: number; x2: number; y2: number; c?: number; maskHead?: string };

function parseLine(line: string): Rec[] {
  const m = /^<(\d+)f>(.*)$/s.exec(line.trim());
  if (!m) return [];
  const frame = Number(m[1]);
  const recs: Rec[] = [];
  // Record: <id><|box;k=v;...|><|mask;...|>, records comma-separated.
  const re = /(\d+)<\|box;([^|]*)\|>(?:<\|mask;([^|]*)\|>)?/g;
  for (const r of m[2]!.matchAll(re)) {
    const kv = Object.fromEntries(r[2]!.split(";").map((p) => p.split("=") as [string, string]));
    recs.push({
      frame,
      id: Number(r[1]),
      x1: Number(kv.x1),
      y1: Number(kv.y1),
      x2: Number(kv.x2),
      y2: Number(kv.y2),
      c: kv.c === undefined ? undefined : Number(kv.c),
      maskHead: r[3]?.slice(0, 60),
    });
  }
  return recs;
}

function truthCentres(frame: number): { x: number; y: number }[] {
  const t = frame / truth.fps;
  if (clip === "pendulum") {
    const p = truth.pendulum;
    const th = p.theta0Rad * Math.cos((2 * Math.PI * t) / p.periodS);
    return [{ x: p.pivot.x + p.lengthPx * Math.sin(th), y: p.pivot.y + p.lengthPx * Math.cos(th) }];
  }
  const c = truth.collision;
  const before = t < c.tHit;
  const xa = before ? c.a.x0 + c.a.v * t : c.a.x0 + c.a.v * c.tHit + c.b.v * (t - c.tHit);
  const xb = before ? c.b.x0 + c.b.v * t : c.b.x0 + c.b.v * c.tHit + c.a.v * (t - c.tHit);
  return [{ x: xa, y: c.y }, { x: xb, y: c.y }];
}

const started = Date.now();
const video = useDataUrl
  ? { type: "input_video", video_url: dataUrl(path, "video/mp4") }
  : { type: "input_video", file_id: await uploadFile(path, "video/mp4") };
console.log(`Input via ${useDataUrl ? "data URL" : "file upload"} (${Date.now() - started} ms)`);

const events: string[] = [];
let firstLineMs: number | undefined;
let text = "";
for await (const ev of streamResponse({
  model: "sam-3.1",
  input: [{ type: "message", role: "user", content: [{ type: "input_text", text: prompt }, video] }],
  ...(process.argv.includes("--confidence") ? { metadata: { include_confidence: "true" } } : {}),
})) {
  if (!events.includes(ev.type)) events.push(ev.type);
  if (ev.type === "response.output_text.delta") {
    firstLineMs ??= Date.now() - started;
    text += String(ev.delta);
  } else if (ev.type === "response.output_text.done") {
    console.log(`output_text.done text length ${String(ev.text ?? "").length}`);
    if (!text) text = String(ev.text ?? "");
  } else if (ev.type === "response.completed") {
    console.log("Usage:", JSON.stringify((ev.response as { usage?: unknown })?.usage));
  } else if (ev.type.includes("error") || ev.type.includes("failed")) {
    console.log("Error event:", JSON.stringify(ev).slice(0, 1000));
  }
}
// Docs say one delta per frame line; split on frame markers so we don't depend on newlines.
const lines = text
  .split(/(?=<\d+f>)/)
  .map((l) => l.trim())
  .filter(Boolean);
writeFileSync(`spike-out/sam-${clip}.txt`, text);

const recs = lines.flatMap(parseLine);
const frames = new Set(recs.map((r) => r.frame));
const ids = [...new Set(recs.map((r) => r.id))];
console.log(`Event types: ${events.join(", ")}`);
console.log(`First line after ${firstLineMs} ms, done after ${Date.now() - started} ms`);
console.log(`${lines.length} lines, ${frames.size} frames with detections (max frame ${Math.max(...frames)}), object ids: ${ids.join(", ")}`);
console.log("First line (truncated):", lines[0]?.slice(0, 300));
console.log("Mask token head:", recs[0]?.maskHead);

// Centre error: match each record to the nearest truth centre in its frame.
const errs = recs.map((r) => {
  const cx = (r.x1 + r.x2) / 2;
  const cy = (r.y1 + r.y2) / 2;
  return Math.min(...truthCentres(r.frame).map((t) => Math.hypot(cx - t.x, cy - t.y)));
});
errs.sort((a, b) => a - b);
const q = (p: number) => errs[Math.min(errs.length - 1, Math.floor(p * errs.length))]?.toFixed(2);
console.log(`Box-centre error px: median ${q(0.5)}, p95 ${q(0.95)}, max ${q(1)}`);

if (clip === "collision") {
  // Does each id keep to one ball through the contact? Report each id's x at start and end.
  for (const id of ids) {
    const mine = recs.filter((r) => r.id === id).sort((a, b) => a.frame - b.frame);
    const xs = (r: Rec | undefined) => (r ? ((r.x1 + r.x2) / 2).toFixed(0) : "-");
    console.log(`id ${id}: frames ${mine[0]?.frame}-${mine.at(-1)?.frame}, x ${xs(mine[0])} -> ${xs(mine.at(-1))}`);
  }
}
