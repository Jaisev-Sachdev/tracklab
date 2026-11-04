// Track objects through a video with SAM 3.1. Streams the Responses API events (SSE) straight through to the browser,
// which parses them with @meta-sam/parser. Saved outputs for the bundled samples replay free and without a code.
import { TrackRequest } from "@/shared/api";
import { replayOutputText } from "@/shared/sse";
import { demoCodeOf, hasLiveAccess } from "@/server/access";
import { jsonError, LIVE_ACCESS_DENIED, readBody, upstreamError } from "@/server/http";
import { callResponses } from "@/server/meta";
import { BadVideoError, checkVideoLength, samRequestBody, videoInput } from "@/server/sam";
import { cachedOutput, findSample } from "@/server/samples";

export const runtime = "nodejs";
export const maxDuration = 300;

const SSE_HEADERS = { "Content-Type": "text/event-stream", "Cache-Control": "no-store" };

export async function POST(request: Request): Promise<Response> {
  const body = await readBody(request, TrackRequest, 16_000);
  if (!body.ok) return body.response;
  const { video, prompt } = body.data;

  if (video.kind === "sample") {
    const sample = findSample(video.id);
    if (!sample) return jsonError(404, `Unknown sample "${video.id}".`);
    const saved = cachedOutput(sample, prompt);
    if (saved !== undefined) return new Response(replayOutputText(saved), { headers: SSE_HEADERS });
  }

  if (!hasLiveAccess(demoCodeOf(request))) return LIVE_ACCESS_DENIED();

  let media;
  try {
    media = await videoInput(video, new URL(request.url).origin);
    // Bundled samples are short and trusted; uploads are checked before SAM bills for every frame.
    if (video.kind === "blob") await checkVideoLength(video.url);
  } catch (err) {
    if (err instanceof BadVideoError) return jsonError(400, err.message);
    throw err;
  }

  try {
    const upstream = await callResponses(samRequestBody(prompt, media, true), request.signal);
    return new Response(upstream.body, { headers: SSE_HEADERS });
  } catch (err) {
    return upstreamError(err);
  }
}
