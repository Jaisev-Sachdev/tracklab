// One Muse Spark step of the lab-partner agent. The browser holds the conversation and runs the tools.
import { AgentStepRequest } from "@/shared/api";
import { demoCodeOf, hasLiveAccess } from "@/server/access";
import { AgentInputError, agentRequestBody } from "@/server/agent";
import { jsonError, LIVE_ACCESS_DENIED, readBody, upstreamError } from "@/server/http";
import { callResponses } from "@/server/meta";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  if (!hasLiveAccess(demoCodeOf(request))) return LIVE_ACCESS_DENIED();
  // Vercel caps request bodies at 4.5 MB; frames are sent at 640 px wide to stay well under.
  const body = await readBody(request, AgentStepRequest, 4_400_000);
  if (!body.ok) return body.response;

  let upstreamBody;
  try {
    upstreamBody = agentRequestBody(body.data.input);
  } catch (err) {
    if (err instanceof AgentInputError) return jsonError(400, err.message);
    throw err;
  }

  try {
    const res = await callResponses(upstreamBody, request.signal);
    const result = (await res.json()) as { id?: string; output?: unknown; usage?: unknown };
    return Response.json({ id: result.id, output: result.output ?? [], usage: result.usage });
  } catch (err) {
    return upstreamError(err);
  }
}
