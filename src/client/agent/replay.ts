// Recorded lab-partner runs: what a visitor without a demo code can watch. A replay holds the timeline the agent
// produced plus the lab state its tools set, so playback makes no live calls at all.
import type { CollisionResult } from "@/domain/physics/collision";
import type { PendulumResult } from "@/domain/physics/pendulum";
import type { Track } from "@/domain/track/track";
import type { AgentEvent } from "./runner";

type Point = { x: number; y: number };

export type Replay = {
  version: 1;
  sampleId: string;
  recordedAt: string;
  note: string;
  events: AgentEvent[];
  tracks: Track[];
  pivot?: Point;
  line?: { a: Point; b: Point };
  refLength?: string;
  analysis?: { kind: "pendulum"; r: PendulumResult } | { kind: "collision"; r: CollisionResult };
  usage: { inputTokens: number; outputTokens: number; samFrames: number; samImages: number };
};

/** Shrink a JPEG data URL so replays stay small; frames in the timeline are shown as thumbnails anyway. */
async function shrink(url: string, maxWidth: number): Promise<string> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, maxWidth / img.naturalWidth);
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}

export async function buildReplay(r: Omit<Replay, "version" | "recordedAt">): Promise<Replay> {
  const events = await Promise.all(
    r.events.map(async (e) =>
      e.kind === "result" ? { ...e, images: await Promise.all(e.images.map((u) => shrink(u, 320))) } : e,
    ),
  );
  return { ...r, events, version: 1, recordedAt: new Date().toISOString() };
}

/** How long to dwell on each event when playing back, so the run reads like it happened. */
export function dwellMs(e: AgentEvent): number {
  if (e.kind === "say") return 900;
  if (e.kind === "call") return 700;
  if (e.kind === "result") return e.images.length > 0 ? 1100 : 500;
  return 0;
}
