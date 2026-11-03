// Record SAM 3.1's output for a bundled sample and concept prompt, so the sample replays free and without a demo code.
// Usage: npm run cache:sample -- <sample-id> "<noun phrase>"
import { writeFileSync } from "node:fs";
import path from "node:path";
import { readSse } from "@/shared/sse";
import { callResponses } from "@/server/meta";
import { samRequestBody } from "@/server/sam";
import { findSample, promptKey, sampleVideoDataUrl, samples } from "@/server/samples";

const [id, phrase] = process.argv.slice(2);
if (!id || !phrase) throw new Error('usage: cache-sample.ts <sample-id> "<noun phrase>"');
const sample = findSample(id);
if (!sample) throw new Error(`Unknown sample ${id}; see content/samples/index.json`);

const prompt = { kind: "concept", phrase } as const;
const started = Date.now();
const res = await callResponses(
  samRequestBody(prompt, { type: "input_video", video_url: sampleVideoDataUrl(sample) }, true),
);
let text = "";
for await (const ev of readSse(res.body!)) {
  if (ev.type === "response.output_text.delta") text += String(ev.delta);
  if (ev.type === "response.output_text.done" && !text) text = String(ev.text ?? "");
}

const file = `${sample.id}.${phrase.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.txt`;
const dir = path.join(process.cwd(), "content", "samples");
writeFileSync(path.join(dir, file), text);
const updated = samples().map((s) => (s.id === id ? { ...s, cached: { ...s.cached, [promptKey(prompt)]: file } } : s));
writeFileSync(path.join(dir, "index.json"), JSON.stringify(updated, null, 2) + "\n");
const frames = text.split("\n").filter((l) => l.startsWith("<")).length;
console.log(`${id} "${phrase}": ${frames} frame lines in ${Date.now() - started} ms -> content/samples/${file}`);
