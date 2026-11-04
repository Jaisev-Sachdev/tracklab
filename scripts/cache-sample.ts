// Record SAM 3.1's output for a bundled sample, so it replays free and without a demo code.
// Usage: npm run cache:sample -- <sample-id> "<noun phrase>"
//        npm run cache:sample -- <sample-id> --box <frame> <x1> <y1> <x2> <y2>   (one object, id 0)
import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildObjectPrompt } from "@meta-sam/parser";
import type { SamPrompt } from "@/shared/api";
import { readSse } from "@/shared/sse";
import { callResponses } from "@/server/meta";
import { samRequestBody } from "@/server/sam";
import { findSample, promptKey, sampleVideoDataUrl, samples } from "@/server/samples";

const [id, ...rest] = process.argv.slice(2);
if (!id || rest.length === 0)
  throw new Error('usage: cache-sample.ts <sample-id> "<noun phrase>" | --box f x1 y1 x2 y2');
const sample = findSample(id);
if (!sample) throw new Error(`Unknown sample ${id}; see content/samples/index.json`);

let prompt: SamPrompt;
let slug: string;
if (rest[0] === "--box") {
  const [frame, x1, y1, x2, y2] = rest.slice(1).map(Number) as [number, number, number, number, number];
  const text = buildObjectPrompt({
    size: { width: sample.width, height: sample.height },
    objects: [{ id: 0, prompts: [{ frame, box: { left: x1, top: y1, right: x2, bottom: y2 } }] }],
  });
  prompt = { kind: "objects", text };
  slug = `box-${frame}-${x1}-${y1}`;
} else {
  prompt = { kind: "concept", phrase: rest.join(" ") };
  slug = rest
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}

const started = Date.now();
const res = await callResponses(
  samRequestBody(prompt, { type: "input_video", video_url: sampleVideoDataUrl(sample) }, true),
);
let text = "";
for await (const ev of readSse(res.body!)) {
  if (ev.type === "response.output_text.delta") text += String(ev.delta);
  if (ev.type === "response.output_text.done" && !text) text = String(ev.text ?? "");
}

const file = `${sample.id}.${slug}.txt`;
const dir = path.join(process.cwd(), "content", "samples");
writeFileSync(path.join(dir, file), text);
const updated = samples().map((s) => (s.id === id ? { ...s, cached: { ...s.cached, [promptKey(prompt)]: file } } : s));
writeFileSync(path.join(dir, "index.json"), JSON.stringify(updated, null, 2) + "\n");
const frames = text.split("\n").filter((l) => l.startsWith("<")).length;
console.log(`${id} ${slug}: ${frames} frame lines in ${Date.now() - started} ms -> content/samples/${file}`);
