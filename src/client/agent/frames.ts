// Still frames for the agent: grab a decoded frame at source resolution, optionally annotate it, and encode it small.
import { objectColor } from "@meta-sam/graphics";
import type { Track } from "@/domain/track/track";

type Point = { x: number; y: number };

export type Annotations = {
  frame: number;
  tracks: Track[];
  pivot?: Point;
  line?: { a: Point; b: Point };
};

/** Copy `source` onto a canvas of exactly `width`×`height` (the video's own pixel grid). */
export function toSourceCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  c.getContext("2d")!.drawImage(source, 0, 0, width, height);
  return c;
}

/** Draw tracked boxes with ids, the pivot and the scale line, in source pixels. */
export function annotate(canvas: HTMLCanvasElement, a: Annotations): void {
  const ctx = canvas.getContext("2d")!;
  const lw = Math.max(2, canvas.width / 400);
  ctx.lineWidth = lw;
  ctx.font = `${Math.round(lw * 9)}px sans-serif`;
  for (const t of a.tracks) {
    const s = t.samples.find((x) => x.frame === a.frame);
    if (!s) continue;
    const color = objectColor(t.objectId);
    ctx.strokeStyle = color;
    ctx.strokeRect(s.box.left, s.box.top, s.box.right - s.box.left, s.box.bottom - s.box.top);
    ctx.fillStyle = color;
    ctx.fillText(`id ${t.objectId}`, s.box.left, Math.max(lw * 9, s.box.top - lw));
  }
  if (a.line) {
    ctx.strokeStyle = "#f5b400";
    ctx.beginPath();
    ctx.moveTo(a.line.a.x, a.line.a.y);
    ctx.lineTo(a.line.b.x, a.line.b.y);
    ctx.stroke();
  }
  if (a.pivot) {
    const r = lw * 5;
    ctx.strokeStyle = "#e5484d";
    ctx.beginPath();
    ctx.moveTo(a.pivot.x - r, a.pivot.y);
    ctx.lineTo(a.pivot.x + r, a.pivot.y);
    ctx.moveTo(a.pivot.x, a.pivot.y - r);
    ctx.lineTo(a.pivot.x, a.pivot.y + r);
    ctx.stroke();
  }
}

/**
 * JPEG data URL fitting within `maxWidth`×`maxHeight` (portrait phone video would otherwise be tall and heavy);
 * returns the scale so coordinates can be mapped back.
 */
export function encodeJpeg(
  canvas: HTMLCanvasElement,
  maxWidth: number,
  maxHeight: number,
  quality = 0.8,
): { url: string; width: number; height: number; scale: number } {
  const scale = Math.min(1, maxWidth / canvas.width, maxHeight / canvas.height);
  const width = Math.round(canvas.width * scale);
  const height = Math.round(canvas.height * scale);
  const out = scale === 1 ? canvas : toSourceCanvas(canvas, width, height);
  return { url: out.toDataURL("image/jpeg", quality), width, height, scale };
}

/** Index of the frame whose timestamp is closest to `t`. */
export function nearestFrame(frameTimes: readonly number[], t: number): number {
  let lo = 0;
  let hi = frameTimes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frameTimes[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(frameTimes[lo - 1]! - t) <= Math.abs(frameTimes[lo]! - t)) return lo - 1;
  return lo;
}
