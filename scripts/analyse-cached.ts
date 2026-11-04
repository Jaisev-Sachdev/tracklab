// Analyse saved SAM output for a sample offline (no API calls).
// Usage: npm run analyse:cached -- <sample-id> <cached-file> pendulum <pivotX> <pivotY> [lengthM]
import { readFileSync } from "node:fs";
import path from "node:path";
import { analysePendulum } from "@/domain/physics/pendulum";
import { parseVideoText } from "@/domain/track/parse";
import { coverage, tracksFromRecords } from "@/domain/track/track";
import { formatMeasured, sigmaFrom } from "@/shared/format";
import { findSample } from "@/server/samples";

const [id, file, kind, px, py, len] = process.argv.slice(2);
const sample = findSample(id ?? "");
if (!sample || !file || kind !== "pendulum") throw new Error("usage: <sample-id> <cached-file> pendulum <px> <py> [L]");
const { records } = await parseVideoText(readFileSync(path.join("content", "samples", file), "utf8"));
const frameTimes = Array.from({ length: sample.frames }, (_, i) => i / sample.fps);
const tracks = tracksFromRecords(records, { frameTimes, width: sample.width, height: sample.height });
for (const t of tracks) console.log("track", t.objectId, coverage(t, sample.frames));
const r = analysePendulum(tracks[0]!, {
  pivot: { x: Number(px), y: Number(py) },
  measuredLengthM: len ? { value: Number(len), se: 0.005 } : undefined,
});
console.log({
  g: r.g && formatMeasured(r.g, "m/s²"),
  sigma: r.g && sigmaFrom(r.g, 9.81).toFixed(2),
  period: formatMeasured(r.periodS, "s"),
  small: formatMeasured(r.smallAnglePeriodS, "s"),
  amplitudeDeg: r.amplitudeDeg.toFixed(1),
  cycles: r.cycles.toFixed(1),
  damping: r.dampingPerS.toFixed(4),
  lengthPx: formatMeasured(r.lengthPx, "px"),
  fitRmsDeg: r.fitRmsDeg.toFixed(3),
  warnings: r.warnings,
});
