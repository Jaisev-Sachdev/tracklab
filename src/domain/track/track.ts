// SAM 3.1 video records -> per-object position tracks.
import { decodeMaskToRaster, frameIndexOf, type SegmentationRecord } from "@meta-sam/parser";

export type Box = { left: number; top: number; right: number; bottom: number };

export type Sample = {
  frame: number;
  /** Seconds from the start of the video. */
  t: number;
  /** Object centre in source pixels: mask centroid when there is a mask, box centre otherwise. */
  x: number;
  y: number;
  box: Box;
  /** The box touches the frame edge, so part of the object may be cut off and the centre is biased. */
  clipped: boolean;
};

export type Track = { objectId: string; samples: Sample[] };

export type TrackOptions = {
  /** Presentation time in seconds of each frame index. */
  frameTimes: readonly number[];
  width: number;
  height: number;
  /** A box within this many pixels of an edge counts as clipped. */
  edgeMarginPx?: number;
};

/** Pixel-centre centroid of a mask raster covering the half-open box `bounds`. */
function maskCentroid(raster: Uint8Array, w: number, h: number, bounds: Box): { x: number; y: number } | undefined {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < raster.length; i++) {
    if (!raster[i]) continue;
    sx += i % w;
    sy += Math.floor(i / w);
    n++;
  }
  if (n === 0) return undefined;
  // The raster may be smaller than the box; scale raster cells onto the box.
  const scaleX = (bounds.right - bounds.left) / w;
  const scaleY = (bounds.bottom - bounds.top) / h;
  return { x: bounds.left + (sx / n + 0.5) * scaleX, y: bounds.top + (sy / n + 0.5) * scaleY };
}

export function tracksFromRecords(records: readonly SegmentationRecord[], opts: TrackOptions): Track[] {
  const margin = opts.edgeMarginPx ?? 2;
  // One sample per (object, frame); a mask record wins over a bare box record.
  const byObject = new Map<string, Map<number, Sample & { fromMask: boolean }>>();

  for (const rec of records) {
    if (rec.kind !== "box" && rec.kind !== "mask") continue;
    const frame = frameIndexOf(rec);
    if (frame === undefined) continue;
    const t = opts.frameTimes[frame];
    if (t === undefined) continue;
    const box: Box =
      rec.kind === "mask" ? { ...rec.bounds } : { left: rec.left, top: rec.top, right: rec.right, bottom: rec.bottom };

    let centre = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
    if (rec.kind === "mask") {
      const c = maskCentroid(decodeMaskToRaster(rec.mask), rec.mask.width, rec.mask.height, box);
      if (c) centre = c;
    }

    const frames = byObject.get(rec.objectId) ?? new Map();
    byObject.set(rec.objectId, frames);
    const existing = frames.get(frame);
    if (existing?.fromMask && rec.kind === "box") continue;

    const clipped =
      box.left <= margin || box.top <= margin || box.right >= opts.width - margin || box.bottom >= opts.height - margin;
    frames.set(frame, { frame, t, ...centre, box, clipped, fromMask: rec.kind === "mask" });
  }

  return [...byObject.entries()]
    .map(([objectId, frames]) => ({
      objectId,
      samples: [...frames.values()].sort((a, b) => a.frame - b.frame).map(({ fromMask: _, ...s }) => s),
    }))
    .sort((a, b) => b.samples.length - a.samples.length);
}

export type Coverage = {
  objectId: string;
  framesTracked: number;
  totalFrames: number;
  /** Fraction of all frames with a sample. */
  fraction: number;
  clippedFrames: number;
  /** Longest run of consecutive missing frames between the first and last sample. */
  longestGap: number;
};

export function coverage(track: Track, totalFrames: number): Coverage {
  let longestGap = 0;
  for (let i = 1; i < track.samples.length; i++) {
    longestGap = Math.max(longestGap, track.samples[i]!.frame - track.samples[i - 1]!.frame - 1);
  }
  return {
    objectId: track.objectId,
    framesTracked: track.samples.length,
    totalFrames,
    fraction: totalFrames > 0 ? track.samples.length / totalFrames : 0,
    clippedFrames: track.samples.filter((s) => s.clipped).length,
    longestGap,
  };
}
