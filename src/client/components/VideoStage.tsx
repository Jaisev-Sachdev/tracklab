"use client";

import { SegmentationRenderer } from "@meta-sam/graphics";
import type { VideoSegmentationResult, VideoSegmentationSnapshot } from "@meta-sam/parser";
import { Video, type MediaPlayerLoadedMetadata, type VideoRef } from "@meta-sam/react";
import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { toScreen, toSource, type Size } from "../geometry";

export type Point = { x: number; y: number };
export type Line = { a: Point; b: Point };
export type ClickMode = "none" | "pivot" | "line";

export type StageOverlays = {
  pivot?: Point;
  line?: Line;
  /** Faint paths of tracked centres, per object id. */
  trails?: { id: string; color: string; points: Point[] }[];
};

type Props = {
  src: string | Blob;
  media: Size | undefined;
  result: VideoSegmentationResult | VideoSegmentationSnapshot | undefined;
  overlays: StageOverlays;
  mode: ClickMode;
  /** Changes whenever the click mode is entered or left; a line's first end only counts within one session. */
  clickSession: number;
  /** A pivot click (mode "pivot"). */
  onPick: (p: Point) => void;
  /** Both ends of the scale line (mode "line"). */
  onLine: (l: Line) => void;
  onLoadedMetadata: (m: MediaPlayerLoadedMetadata) => void;
  onFrame: (frameIndex: number, time: number) => void;
  onError: (e: Error) => void;
  videoRef: Ref<VideoRef>;
};

/** Meta's frame-exact player with SAM's overlay, plus our own canvas on top for the pivot, scale line and trails. */
export function VideoStage({
  src,
  media,
  result,
  overlays,
  mode,
  clickSession,
  onPick,
  onLine,
  onLoadedMetadata,
  onFrame,
  onError,
  videoRef,
}: Props) {
  // Long, high-frame-rate clips hold many masks; the defaults (4,096 masks) would reject a 60 s, 60 fps pair.
  const renderer = useMemo(
    () => new SegmentationRenderer({ boxLabels: true, maxMasks: 16_384, maxBoxes: 16_384, maxRecords: 40_000 }),
    [],
  );
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState<Size>({ width: 0, height: 0 });
  // First end of a scale line, remembered only while still in line mode.
  const [firstEnd, setFirstEnd] = useState<{ p: Point; session: number } | undefined>();
  const pending = mode === "line" && firstEnd?.session === clickSession ? firstEnd.p : undefined;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !media || box.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(box.width * dpr);
    c.height = Math.round(box.height * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);
    const s = (p: Point) => toScreen(p, media, box);

    for (const trail of overlays.trails ?? []) {
      ctx.strokeStyle = trail.color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      trail.points.forEach((p, i) => {
        const q = s(p);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const line = overlays.line ?? (pending ? { a: pending, b: pending } : undefined);
    if (line) {
      const a = s(line.a);
      const b = s(line.b);
      ctx.strokeStyle = "#f5b400";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const q of [a, b]) {
        ctx.fillStyle = "#f5b400";
        ctx.beginPath();
        ctx.arc(q.x, q.y, 4, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    if (overlays.pivot) {
      const q = s(overlays.pivot);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(q.x - 9, q.y);
      ctx.lineTo(q.x + 9, q.y);
      ctx.moveTo(q.x, q.y - 9);
      ctx.lineTo(q.x, q.y + 9);
      ctx.stroke();
      ctx.strokeStyle = "#e5484d";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [overlays, pending, media, box]);

  function click(e: React.MouseEvent<HTMLCanvasElement>) {
    if (mode === "none" || !media) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const p = toSource({ x: e.clientX - rect.left, y: e.clientY - rect.top }, media, box);
    if (!p) return;
    if (mode === "pivot") {
      onPick(p);
    } else if (!pending) {
      setFirstEnd({ p, session: clickSession });
    } else {
      setFirstEnd(undefined);
      onLine({ a: pending, b: p });
    }
  }

  return (
    <div className="stage" ref={wrap} style={media ? { aspectRatio: `${media.width} / ${media.height}` } : undefined}>
      <Video
        ref={videoRef}
        src={src}
        result={result}
        renderer={renderer}
        objectFit="contain"
        muted
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        canvasProps={{ "aria-label": "Experiment video with tracked objects" }}
        onLoadedMetadata={onLoadedMetadata}
        onFrame={({ frameIndex, time }) => onFrame(frameIndex, time)}
        onError={onError}
      />
      <canvas
        ref={canvas}
        className={mode === "none" ? "overlay" : "overlay picking"}
        onClick={click}
        aria-label={
          mode === "pivot" ? "Click the pivot" : mode === "line" ? "Click both ends of the reference" : undefined
        }
      />
    </div>
  );
}
