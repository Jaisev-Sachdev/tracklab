// Spike helpers for the Meta Model API: auth, file upload, and SSE streaming of /v1/responses.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

export const BASE_URL = "https://api.meta.ai/v1";

function apiKey(): string {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error("MODEL_API_KEY is not set; put it in .env.local (see .env.example)");
  return key;
}

async function failOnError(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text();
  throw new Error(`${what} failed: HTTP ${res.status} ${res.statusText}\n${body.slice(0, 2000)}`);
}

export async function uploadFile(path: string, mime: string): Promise<string> {
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("file", new Blob([readFileSync(path)], { type: mime }), basename(path));
  const res = await fetch(`${BASE_URL}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  await failOnError(res, "File upload");
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error(`File upload returned no id: ${JSON.stringify(json)}`);
  return json.id;
}

export function dataUrl(path: string, mime: string): string {
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}

export type SseEvent = { type: string; [k: string]: unknown };

/** POST /v1/responses with stream: true; yields each parsed SSE event. */
export async function* streamResponse(body: Record<string, unknown>): AsyncGenerator<SseEvent> {
  const res = await fetch(`${BASE_URL}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ ...body, stream: true }),
  });
  await failOnError(res, "Responses call");
  if (!res.body) throw new Error("Responses call returned no body");
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk as Uint8Array, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      yield JSON.parse(data) as SseEvent;
    }
  }
}

/** POST /v1/responses without streaming; returns the parsed JSON. */
export async function createResponse(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await failOnError(res, "Responses call");
  return (await res.json()) as Record<string, unknown>;
}
