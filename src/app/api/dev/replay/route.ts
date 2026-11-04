// Development only: save a recorded lab-partner run as public/replays/<sample>.json. Production answers 404, so
// nothing can write to the deployment.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { env } from "@/server/env";
import { jsonError, readTextCapped } from "@/server/http";
import { findSample } from "@/server/samples";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (env().NODE_ENV !== "development") return jsonError(404, "Not found.");
  const text = await readTextCapped(request, 4_000_000);
  if (text === undefined) return jsonError(413, "Replay too large.");
  let replay: { sampleId?: unknown; version?: unknown };
  try {
    replay = JSON.parse(text) as typeof replay;
  } catch {
    return jsonError(400, "Body must be JSON.");
  }
  const id = String(replay.sampleId ?? "");
  if (replay.version !== 1 || !/^[a-z0-9-]{1,64}$/.test(id) || !findSample(id)) {
    return jsonError(400, "Not a replay of a bundled sample.");
  }
  const dir = path.join(process.cwd(), "public", "replays");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${id}.json`), text);
  return Response.json({ saved: `/replays/${id}.json`, bytes: text.length });
}
