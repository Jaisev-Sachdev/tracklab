import "server-only";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { SamPrompt } from "@/shared/api";

const Sample = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  /** Attribution shown with the video (required for licensed footage). */
  credit: z.string(),
  creditUrl: z.url().optional(),
  /** Path under public/, served as-is. */
  video: z.string().startsWith("/samples/"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  frames: z.number().int().positive(),
  /** Prompt key -> file in content/samples/ holding SAM's saved output text for that prompt. */
  cached: z.record(z.string(), z.string()),
});
export type Sample = z.infer<typeof Sample>;

const CONTENT = path.join(process.cwd(), "content", "samples");
const PUBLIC = path.join(process.cwd(), "public");

let registry: Sample[] | undefined;

export function samples(): Sample[] {
  registry ??= z.array(Sample).parse(JSON.parse(readFileSync(path.join(CONTENT, "index.json"), "utf8")));
  return registry;
}

export const findSample = (id: string) => samples().find((s) => s.id === id);

/** Stable cache key for a prompt: the lower-cased phrase, or a hash of the object-prompt text. */
export function promptKey(prompt: SamPrompt): string {
  return prompt.kind === "concept"
    ? `concept:${prompt.phrase.trim().toLowerCase()}`
    : `objects:${createHash("sha256").update(prompt.text).digest("hex").slice(0, 16)}`;
}

/** SAM's saved output for this sample and prompt, if we recorded it. */
export function cachedOutput(sample: Sample, prompt: SamPrompt): string | undefined {
  const file = sample.cached[promptKey(prompt)];
  return file === undefined ? undefined : readFileSync(path.join(CONTENT, path.basename(file)), "utf8");
}

/** The sample video as a data URL, for when the Meta API can't fetch it from us (local development). */
export function sampleVideoDataUrl(sample: Sample): string {
  const bytes = readFileSync(path.join(PUBLIC, sample.video));
  return `data:video/mp4;base64,${bytes.toString("base64")}`;
}
