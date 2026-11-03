import "server-only";
import { env } from "./env";

export const META_BASE_URL = "https://api.meta.ai/v1";

export class MetaApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

/**
 * POST /v1/responses. Returns the raw response (a stream when `body.stream` is true) after checking the status, so
 * callers can pipe it. Errors carry Meta's status and a trimmed message, never our key.
 */
export async function callResponses(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(`${META_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env().MODEL_API_KEY}`,
      "Content-Type": "application/json",
      Accept: body.stream ? "text/event-stream" : "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new MetaApiError(res.status, `Meta Model API returned ${res.status}: ${text.slice(0, 500)}`);
  }
  return res;
}

/** The concatenated output text of a non-streamed Responses API result. */
export function outputText(result: { output?: unknown }): string {
  const items = Array.isArray(result.output) ? (result.output as { type?: string; content?: unknown }[]) : [];
  return items
    .filter((item) => item.type === "message" && Array.isArray(item.content))
    .flatMap((item) => item.content as { type?: string; text?: string }[])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}
