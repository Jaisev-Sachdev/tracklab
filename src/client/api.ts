// Browser calls to our API routes. Every billed call carries the demo code the visitor entered.
import {
  parseImageStream,
  parseVideoStream,
  type ResponsesEvent,
  type SegmentationRecord,
  type VideoSegmentationResult,
  type VideoSegmentationSnapshot,
} from "@meta-sam/parser";
import { upload, uploadPresigned } from "@vercel/blob/client";
import { DEMO_CODE_HEADER, type AgentItem, type SamPrompt, type VideoSource } from "@/shared/api";
import { readSse } from "@/shared/sse";
import { getDemoCode } from "./demo-code";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function headers(): Record<string, string> {
  const code = getDemoCode();
  return { "Content-Type": "application/json", ...(code ? { [DEMO_CODE_HEADER]: code } : {}) };
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(path, { method: "POST", headers: headers(), body: JSON.stringify(body), signal });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, err.error ?? `Request failed (${res.status}).`);
  }
  return res;
}

/** Track through the whole video, reporting each cumulative snapshot as SAM streams frames in. */
export async function trackVideo(
  video: VideoSource,
  prompt: SamPrompt,
  opts: { onSnapshot?: (s: VideoSegmentationSnapshot) => void; signal?: AbortSignal } = {},
): Promise<VideoSegmentationResult> {
  const res = await post("/api/sam/track", { video, prompt }, opts.signal);
  const parsed = parseVideoStream(readSse(res.body!) as AsyncIterable<ResponsesEvent>);
  for await (const snapshot of parsed) opts.onSnapshot?.(snapshot);
  return parsed.finalResult;
}

/** Segment one still frame (a JPEG/PNG data URL). */
export async function segmentImage(
  image: string,
  prompt: SamPrompt,
  signal?: AbortSignal,
): Promise<SegmentationRecord[]> {
  const res = await post("/api/sam/image", { image, prompt }, signal);
  const { text } = (await res.json()) as { text: string };
  async function* events(): AsyncIterable<ResponsesEvent> {
    const lane = { item_id: "image", output_index: 0, content_index: 0 };
    if (text) yield { type: "response.output_text.delta", ...lane, delta: text };
    yield { type: "response.output_text.done", ...lane, text };
    yield { type: "response.completed" };
  }
  const parsed = parseImageStream(events());
  for await (const _ of parsed) {
    // Only the final result is needed.
  }
  return [...(await parsed.finalResult).records];
}

export type AgentStepResult = { output: Record<string, unknown>[]; usage?: Record<string, unknown> };

export async function agentStep(input: AgentItem[], signal?: AbortSignal): Promise<AgentStepResult> {
  const res = await post("/api/agent/step", { input }, signal);
  return (await res.json()) as AgentStepResult;
}

/**
 * Upload a video straight to Vercel Blob; our route only authorises it. `mode` follows the store: classic stores use
 * client tokens, OIDC stores use presigned URLs (single PUT, so no multipart).
 */
export async function uploadVideo(
  file: File,
  mode: "token" | "presigned",
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const safeName = file.name.replace(/[^\w.-]+/g, "-").slice(-80) || "video.mp4";
  const common = {
    access: "public" as const,
    handleUploadUrl: "/api/upload",
    headers: headers(),
    onUploadProgress: ({ percentage }: { percentage: number }) => onProgress?.(percentage / 100),
  };
  const blob =
    mode === "token"
      ? await upload(`uploads/${safeName}`, file, { ...common, multipart: file.size > 20 * 1024 * 1024 })
      : await uploadPresigned(`uploads/${safeName}`, file, common);
  return blob.url;
}
