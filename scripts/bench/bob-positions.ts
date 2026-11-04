// Test helper: per-frame bob centre for the classroom pendulum from saved SAM output, used to answer the agent's
// "click the bob" question in automated browser tests. Usage: tsx scripts/bench/bob-positions.ts > positions.json
import { readFileSync } from "node:fs";
import { parseVideoText } from "@/domain/track/parse";
import { tracksFromRecords } from "@/domain/track/track";

const { records } = await parseVideoText(readFileSync("content/samples/pendulum-classroom.box-75-726-538.txt", "utf8"));
const frameTimes = Array.from({ length: 326 }, (_, i) => i / 25);
const [t] = tracksFromRecords(records, { frameTimes, width: 1920, height: 1080 });
console.log(JSON.stringify(Object.fromEntries(t!.samples.map((s) => [s.frame, [Math.round(s.x), Math.round(s.y)]]))));
