// Spike: decode saved SAM output with @meta-sam/parser and compare mask centroids with box centres and truth.
// Usage: tsx scripts/spike/masks.ts   (reads spike-out/sam-pendulum.txt from the last spike:sam run)
import { readFileSync } from "node:fs";
import { decodeMaskToRaster, frameIndexOf, parseVideoStream, recordsOfKind, type ResponsesEvent } from "@meta-sam/parser";

const text = readFileSync("spike-out/sam-pendulum.txt", "utf8");
const truth = JSON.parse(readFileSync("spike-out/truth.json", "utf8"));

async function* events(): AsyncIterable<ResponsesEvent> {
  const base = { item_id: "m", output_index: 0, content_index: 0 };
  yield { type: "response.output_text.delta", ...base, delta: text };
  yield { type: "response.output_text.done", ...base, text };
  yield { type: "response.completed" };
}

const parsed = parseVideoStream(events());
for await (const _ of parsed);
const result = await parsed.finalResult;
console.log("outcome:", result.outcome.status, "diagnostics:", result.diagnostics.length);

const p = truth.pendulum;
const errBox: number[] = [];
const errMask: number[] = [];
for (const rec of recordsOfKind(result.records, "mask")) {
  const f = frameIndexOf(rec);
  const th = p.theta0Rad * Math.cos((2 * Math.PI * (f / truth.fps)) / p.periodS);
  const tx = p.pivot.x + p.lengthPx * Math.sin(th);
  const ty = p.pivot.y + p.lengthPx * Math.cos(th);
  const raster = decodeMaskToRaster(rec.mask);
  const { left, top, right, bottom } = rec.bounds;
  const w = right - left;
  let sx = 0;
  let sy = 0;
  let n = 0;
  raster.forEach((v, i) => {
    if (!v) return;
    sx += i % w;
    sy += Math.floor(i / w);
    n++;
  });
  // Pixel (col, row) covers [col, col+1); its centre is +0.5.
  errMask.push(Math.hypot(left + sx / n + 0.5 - tx, top + sy / n + 0.5 - ty));
  errBox.push(Math.hypot((left + right) / 2 - tx, (top + bottom) / 2 - ty));
}
const stats = (e: number[]) => {
  const s = [...e].sort((a, b) => a - b);
  return `median ${s[s.length >> 1]!.toFixed(2)}, p95 ${s[Math.floor(s.length * 0.95)]!.toFixed(2)}, max ${s.at(-1)!.toFixed(2)}`;
};
console.log(`${errMask.length} masks`);
console.log(`box centre (exclusive bounds) error px: ${stats(errBox)}`);
console.log(`mask centroid error px: ${stats(errMask)}`);
