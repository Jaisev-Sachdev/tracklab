// The browser side of each agent tool in content/agent/tools.json. Results are short, structured text the model can
// read, with numbers already formatted with their uncertainties.
import { buildObjectPrompt, recordsOfKind } from "@meta-sam/parser";
import { analyseCollision, type CollisionResult } from "@/domain/physics/collision";
import { analysePendulum, type PendulumResult } from "@/domain/physics/pendulum";
import type { Calibration } from "@/domain/physics/types";
import { coverage, type Track } from "@/domain/track/track";
import type { SamPrompt } from "@/shared/api";
import { formatMeasured, sigmaFrom } from "@/shared/format";
import { segmentImage } from "../api";
import { annotate, encodeJpeg, nearestFrame, toSourceCanvas } from "./frames";
import type { ToolHandler, ToolResult } from "./runner";

type Point = { x: number; y: number };
type Line = { a: Point; b: Point };

export type Question = {
  question: string;
  answerType: "number" | "text" | "click_point" | "click_line";
  unit?: string;
  timeS?: number;
};
export type Answer = { kind: "text"; text: string } | { kind: "point"; p: Point } | { kind: "line"; line: Line };

/** What the tools need from the lab page. Getters read the latest state, not a stale render's. */
export type LabContext = {
  meta: () => { width: number; height: number; numFrames: number; frameTimes: number[] } | undefined;
  seekToFrame: (frame: number) => Promise<void>;
  captureRawFrame: () => HTMLCanvasElement;
  tracks: () => Track[];
  pivot: () => Point | undefined;
  line: () => Line | undefined;
  calibration: () => Calibration | undefined;
  runTracking: (prompt: SamPrompt, signal: AbortSignal) => Promise<Track[]>;
  setPivot: (p: Point) => void;
  setCalibration: (line: Line, lengthM: number) => void;
  ask: (q: Question, signal: AbortSignal) => Promise<Answer>;
  /** Count a billed SAM still-frame call. */
  countImageCall: () => void;
  showPendulum: (r: PendulumResult) => void;
  showCollision: (r: CollisionResult) => void;
};

const r1 = (v: number) => Math.round(v * 10) / 10;
const json = (v: unknown) => JSON.stringify(v, null, 1);

function need<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(what);
  return v;
}

const num = (args: Record<string, unknown>, key: string): number => {
  const v = args[key];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${key} must be a number.`);
  return v;
};

function summariseTracks(tracks: Track[], total: number): string {
  if (tracks.length === 0) return "SAM found no objects for that prompt in this video.";
  return json(
    tracks.map((t) => {
      const c = coverage(t, total);
      const first = t.samples[0]!;
      const last = t.samples.at(-1)!;
      const widths = t.samples.map((s) => s.box.right - s.box.left).sort((a, b) => a - b);
      const xs = t.samples.map((s) => s.x);
      const ys = t.samples.map((s) => s.y);
      return {
        id: t.objectId,
        frames_tracked: `${c.framesTracked}/${total}`,
        frames_cut_off_at_edge: c.clippedFrames,
        longest_gap_frames: c.longestGap,
        typical_width_px: r1(widths[widths.length >> 1]!),
        start: { t_s: r1(first.t), x: r1(first.x), y: r1(first.y) },
        end: { t_s: r1(last.t), x: r1(last.x), y: r1(last.y) },
        x_range_px: [r1(Math.min(...xs)), r1(Math.max(...xs))],
        y_range_px: [r1(Math.min(...ys)), r1(Math.max(...ys))],
      };
    }),
  );
}

export function makeTools(ctx: LabContext): Record<string, ToolHandler> {
  const meta = () => need(ctx.meta(), "The video hasn't loaded yet.");
  const findTrack = (id: unknown) =>
    need(
      ctx.tracks().find((t) => t.objectId === String(id)),
      `No tracked object with id ${String(id)}. Track first.`,
    );

  async function frameAt(timeS: number): Promise<{ frame: number; canvas: HTMLCanvasElement }> {
    const m = meta();
    const frame = nearestFrame(m.frameTimes, Math.max(0, timeS));
    await ctx.seekToFrame(frame);
    return { frame, canvas: toSourceCanvas(ctx.captureRawFrame(), m.width, m.height) };
  }

  const tools: Record<string, ToolHandler> = {
    async get_frames(args) {
      const m = meta();
      const times = (Array.isArray(args.times_s) ? args.times_s : []).filter((t): t is number => typeof t === "number");
      if (times.length === 0) throw new Error("times_s must list 1–4 times in seconds.");
      const images: string[] = [];
      const lines: string[] = [];
      let scale = 1;
      for (const t of times.slice(0, 4)) {
        const { frame, canvas } = await frameAt(t);
        if (args.overlay === true) {
          annotate(canvas, { frame, tracks: ctx.tracks(), pivot: ctx.pivot(), line: ctx.line() });
        }
        const jpeg = encodeJpeg(canvas, 640, 640);
        scale = jpeg.scale;
        images.push(jpeg.url);
        lines.push(`t = ${m.frameTimes[frame]!.toFixed(3)} s (frame ${frame})`);
      }
      const duration = m.frameTimes.at(-1) ?? 0;
      return {
        text:
          `${images.length} frame(s): ${lines.join(", ")}. Video ${m.width}×${m.height} px, ${m.numFrames} frames, ` +
          `${duration.toFixed(2)} s. Images are scaled by ${scale.toFixed(3)}: divide image coordinates by that to get ` +
          `source pixels (or use locate for exact positions).`,
        images,
      } satisfies ToolResult;
    },

    async track(args, signal) {
      const phrase = String(args.prompt ?? "").trim();
      if (!phrase) throw new Error("prompt must be a short noun phrase.");
      const tracks = await ctx.runTracking({ kind: "concept", phrase }, signal);
      return { text: summariseTracks(tracks, meta().numFrames) };
    },

    async track_boxes(args, signal) {
      const m = meta();
      const frame = nearestFrame(m.frameTimes, num(args, "time_s"));
      const boxes = Array.isArray(args.boxes) ? (args.boxes as Record<string, number>[]) : [];
      if (boxes.length === 0) throw new Error("boxes must list at least one box.");
      const clampX = (v: number) => Math.min(m.width, Math.max(0, v));
      const clampY = (v: number) => Math.min(m.height, Math.max(0, v));
      const text = buildObjectPrompt({
        size: { width: m.width, height: m.height },
        objects: boxes.map((b) => {
          const left = Math.floor(clampX(Math.min(b.x1!, b.x2!)));
          const top = Math.floor(clampY(Math.min(b.y1!, b.y2!)));
          return {
            id: Math.trunc(b.id ?? 0),
            prompts: [
              {
                frame,
                box: {
                  left,
                  top,
                  right: Math.max(left + 1, Math.ceil(clampX(Math.max(b.x1!, b.x2!)))),
                  bottom: Math.max(top + 1, Math.ceil(clampY(Math.max(b.y1!, b.y2!)))),
                },
              },
            ],
          };
        }),
      });
      const tracks = await ctx.runTracking({ kind: "objects", text }, signal);
      return { text: summariseTracks(tracks, m.numFrames) };
    },

    async locate(args, signal) {
      const phrase = String(args.prompt ?? "").trim();
      if (!phrase) throw new Error("prompt must be a short noun phrase.");
      const { frame, canvas } = await frameAt(num(args, "time_s"));
      // Full detail matters for small things like a clamp; cap very large phone frames to keep the request small.
      const jpeg = encodeJpeg(canvas, 1920, 1920, 0.9);
      ctx.countImageCall();
      const records = await segmentImage(jpeg.url, { kind: "concept", phrase }, signal);
      const boxes = recordsOfKind(records, "box").map((b) => {
        const [x1, y1, x2, y2] = [b.left, b.top, b.right, b.bottom].map((v) => r1(v / jpeg.scale)) as [
          number,
          number,
          number,
          number,
        ];
        return { id: b.objectId, x1, y1, x2, y2, centre: { x: r1((x1 + x2) / 2), y: r1((y1 + y2) / 2) } };
      });
      if (boxes.length === 0) return { text: `No "${phrase}" found in frame ${frame}.` };
      return { text: `Matches in frame ${frame}, in source pixels:\n${json(boxes)}` };
    },

    async set_pivot(args) {
      const p = { x: num(args, "x"), y: num(args, "y") };
      const m = meta();
      if (p.x < 0 || p.y < 0 || p.x > m.width || p.y > m.height) throw new Error("The pivot must be inside the frame.");
      ctx.setPivot(p);
      return { text: `Pivot set at (${r1(p.x)}, ${r1(p.y)}).` };
    },

    async set_calibration(args) {
      const line = { a: { x: num(args, "x1"), y: num(args, "y1") }, b: { x: num(args, "x2"), y: num(args, "y2") } };
      const length = num(args, "length_m");
      if (!(length > 0)) throw new Error("length_m must be positive.");
      ctx.setCalibration(line, length);
      const c = need(ctx.calibration(), "That line is too short to calibrate with; use the whole reference object.");
      return { text: `Scale set: ${formatMeasured({ value: c.pxPerM, se: c.pxPerMSe }, "px/m")}.` };
    },

    async ask_user(args, signal) {
      const type = String(args.answer_type);
      if (!["number", "text", "click_point", "click_line"].includes(type)) throw new Error("Unknown answer_type.");
      const answer = await ctx.ask(
        {
          question: String(args.question ?? ""),
          answerType: type as Question["answerType"],
          unit: typeof args.unit === "string" ? args.unit : undefined,
          timeS: typeof args.time_s === "number" ? args.time_s : undefined,
        },
        signal,
      );
      if (answer.kind === "point")
        return { text: `The person clicked (${r1(answer.p.x)}, ${r1(answer.p.y)}) in source pixels.` };
      if (answer.kind === "line") {
        const { a, b } = answer.line;
        return {
          text: `The person drew a line from (${r1(a.x)}, ${r1(a.y)}) to (${r1(b.x)}, ${r1(b.y)}) in source pixels.`,
        };
      }
      return {
        text: answer.text.trim() ? `The person answered: ${answer.text.trim()}` : "The person skipped the question.",
      };
    },

    async analyse_pendulum(args) {
      const L = typeof args.measured_length_m === "number" ? args.measured_length_m : undefined;
      // A tape is good to about a millimetre at best; never let the model claim better.
      const Lse = Math.max(0.001, typeof args.measured_length_se_m === "number" ? args.measured_length_se_m : 0.002);
      const r = analysePendulum(findTrack(args.object_id), {
        pivot: ctx.pivot(),
        calibration: ctx.calibration(),
        measuredLengthM: L !== undefined && L > 0 ? { value: L, se: Lse } : undefined,
      });
      ctx.showPendulum(r);
      return {
        text: json({
          g: r.g ? formatMeasured(r.g, "m/s²") : "not available",
          g_vs_9_81_in_standard_errors: r.g ? Number(sigmaFrom(r.g, 9.81).toFixed(2)) : null,
          // Lets the model diagnose a length problem from a number our code computed, not one it guessed.
          length_that_would_give_9_81_m:
            r.g && r.lengthUsedM ? Number(((r.lengthUsedM.value * 9.81) / r.g.value).toFixed(4)) : null,
          uncertainty_budget_percent_of_variance: r.uncertaintyBudget
            ? Object.fromEntries(Object.entries(r.uncertaintyBudget).map(([k, v]) => [k, Math.round((v ?? 0) * 100)]))
            : null,
          period: formatMeasured(r.periodS, "s"),
          small_swing_period: formatMeasured(r.smallAnglePeriodS, "s"),
          amplitude_deg: r1(r.amplitudeDeg),
          amplitude_correction_percent: Number((r.amplitudeCorrection * 100).toFixed(3)),
          cycles: r1(r.cycles),
          damping_per_s: Number(r.dampingPerS.toFixed(4)),
          length_used: r.lengthUsedM ? `${formatMeasured(r.lengthUsedM, "m")} (${r.lengthUsedM.source})` : "none",
          length_from_video: r.lengthFromVideoM ? formatMeasured(r.lengthFromVideoM, "m") : "not available",
          pivot: `${r.pivot.source} at (${r1(r.pivot.x)}, ${r1(r.pivot.y)})`,
          fit_rms_deg: Number(r.fitRmsDeg.toFixed(3)),
          frames_used: r.samplesUsed,
          warnings: r.warnings,
        }),
      };
    },

    async analyse_collision(args) {
      if (String(args.object_a) === String(args.object_b))
        throw new Error("object_a and object_b must be different objects.");
      const r = analyseCollision(findTrack(args.object_a), findTrack(args.object_b), {
        massA: num(args, "mass_a_kg"),
        massB: num(args, "mass_b_kg"),
        calibration: ctx.calibration(),
      });
      ctx.showCollision(r);
      const u = r.unit;
      return {
        text: json({
          momentum_ratio_after_over_before: formatMeasured(r.momentumRatio),
          momentum_ratio_vs_1_in_standard_errors: Number(sigmaFrom(r.momentumRatio, 1).toFixed(2)),
          restitution: formatMeasured(r.restitution),
          kinetic_energy_ratio: formatMeasured(r.energyRatio),
          velocities: {
            [`object_${r.objectIds[0]}`]: `${formatMeasured(r.velocities.a.before, u)} -> ${formatMeasured(r.velocities.a.after, u)}`,
            [`object_${r.objectIds[1]}`]: `${formatMeasured(r.velocities.b.before, u)} -> ${formatMeasured(r.velocities.b.after, u)}`,
          },
          contact_time_s: Number(r.contactT.toFixed(3)),
          warnings: r.warnings,
        }),
      };
    },
  };
  return tools;
}
