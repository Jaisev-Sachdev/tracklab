// Segment one still frame with SAM 3.1 (find the pivot, a ruler, or an object to re-prompt tracking with a box).
// Returns SAM's output text; the browser parses it with @meta-sam/parser.
import { ImageRequest } from "@/shared/api";
import { demoCodeOf, hasLiveAccess } from "@/server/access";
import { LIVE_ACCESS_DENIED, readBody, upstreamError } from "@/server/http";
import { callResponses, outputText } from "@/server/meta";
import { samRequestBody } from "@/server/sam";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  if (!hasLiveAccess(demoCodeOf(request))) return LIVE_ACCESS_DENIED();
  const body = await readBody(request, ImageRequest, 4_200_000);
  if (!body.ok) return body.response;

  try {
    const res = await callResponses(
      samRequestBody(body.data.prompt, { type: "input_image", image_url: body.data.image }, false),
      request.signal,
    );
    return Response.json({ text: outputText(await res.json()) });
  } catch (err) {
    return upstreamError(err);
  }
}
