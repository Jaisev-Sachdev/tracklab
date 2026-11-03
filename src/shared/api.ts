// Request bodies for our API routes, shared by the browser (to build them) and the server (to validate them).
import { z } from "zod";

/** Where the video lives: a bundled sample, or a file the user uploaded to Vercel Blob. */
export const VideoSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sample"), id: z.string().regex(/^[a-z0-9-]{1,64}$/) }),
  z.object({ kind: z.literal("blob"), url: z.url({ protocol: /^https$/ }) }),
]);
export type VideoSource = z.infer<typeof VideoSource>;

/**
 * The grammar `buildObjectPrompt` emits: per frame `<Nf>`, then comma-separated objects, each an id followed by box and
 * point tokens (a negative point is prefixed with `-`).
 */
const TOKEN = String.raw`-?<\|(?:box|point);[a-z0-9=;]*\|>`;
const OBJECT = String.raw`\d+(?:${TOKEN})+`;
const OBJECT_PROMPT = new RegExp(String.raw`^(?:<\d+f>${OBJECT}(?:,${OBJECT})*)+$`);

/**
 * What SAM should segment: a short noun phrase ("red ball"), or object prompts (boxes/points on given frames) built
 * with `buildObjectPrompt` from `@meta-sam/parser`.
 */
export const SamPrompt = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("concept"),
    phrase: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[^<>|\n]+$/, "A concept is a short noun phrase."),
  }),
  z.object({
    kind: z.literal("objects"),
    text: z.string().min(1).max(8000).regex(OBJECT_PROMPT, "Object prompts must be built with buildObjectPrompt."),
  }),
]);
export type SamPrompt = z.infer<typeof SamPrompt>;

export const TrackRequest = z.object({ video: VideoSource, prompt: SamPrompt });
export type TrackRequest = z.infer<typeof TrackRequest>;

const dataImage = (maxChars: number) =>
  z
    .string()
    .max(maxChars)
    .regex(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/, "Expected a JPEG or PNG data URL.");

/** A still frame as a JPEG or PNG data URL, about 3 MB at most once base64-encoded. */
export const ImageRequest = z.object({ image: dataImage(4_000_000), prompt: SamPrompt });
export type ImageRequest = z.infer<typeof ImageRequest>;

export const MAX_AGENT_ITEMS = 160;
export const MAX_AGENT_IMAGES = 24;

// Agent conversation items, allowlisted. Only inline images: no remote URLs, files or videos, so the key can't be
// pointed at other media. Zod objects drop unknown keys (ids, statuses, annotations) on the way through.
const InputText = z.object({ type: z.literal("input_text"), text: z.string().max(20_000) });
const InputImage = z.object({
  type: z.literal("input_image"),
  image_url: dataImage(1_500_000),
  detail: z.enum(["low", "high", "auto"]).optional(),
});
const InputPart = z.discriminatedUnion("type", [InputText, InputImage]);
const OutputText = z.object({ type: z.literal("output_text"), text: z.string().max(20_000) });

export const AgentItem = z.union([
  z.object({
    type: z.literal("message").optional(),
    role: z.literal("user"),
    content: z.union([z.string().max(20_000), z.array(InputPart).min(1).max(12)]),
  }),
  z.object({
    type: z.literal("message").optional(),
    role: z.literal("assistant"),
    content: z.union([z.string().max(20_000), z.array(OutputText).max(8)]),
  }),
  z.object({
    type: z.literal("function_call"),
    call_id: z.string().min(1).max(200),
    name: z.string().min(1).max(64),
    arguments: z.string().max(20_000),
  }),
  z.object({
    type: z.literal("function_call_output"),
    call_id: z.string().min(1).max(200),
    output: z.union([z.string().max(60_000), z.array(InputPart).max(8)]),
  }),
]);
export type AgentItem = z.infer<typeof AgentItem>;

/** The conversation so far as Responses API input items. The server adds the model, instructions and tools. */
export const AgentStepRequest = z.object({ input: z.array(AgentItem).min(1).max(MAX_AGENT_ITEMS) });
export type AgentStepRequest = z.infer<typeof AgentStepRequest>;

/** A bundled sample as the browser sees it. */
export type SampleInfo = {
  id: string;
  title: string;
  description: string;
  video: string;
  /** Concept prompts with saved SAM output, which replay without a demo code. */
  cachedPrompts: string[];
};

/** Header carrying the demo code that unlocks live (billed) calls. */
export const DEMO_CODE_HEADER = "x-demo-code";

export type ApiError = { error: string };
