import "server-only";
import type { z } from "zod";
import type { ApiError } from "@/shared/api";
import { MetaApiError } from "./meta";

export const jsonError = (status: number, error: string) => Response.json({ error } satisfies ApiError, { status });

export const LIVE_ACCESS_DENIED = () =>
  jsonError(401, "Live analysis needs a demo code. The bundled samples still replay without one.");

/** The body as text, or undefined once it passes `maxBytes` (counted as it streams, so it's never fully buffered). */
export async function readTextCapped(request: Request, maxBytes: number): Promise<string | undefined> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return undefined;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Parse a JSON body against a schema, with a byte cap. */
export async function readBody<T extends z.ZodType>(
  request: Request,
  schema: T,
  maxBytes: number,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  const text = await readTextCapped(request, maxBytes);
  if (text === undefined) return { ok: false, response: jsonError(413, "Request too large.") };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, response: jsonError(400, "Body must be JSON.") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, response: jsonError(400, `Invalid request: ${issue?.path.join(".")} ${issue?.message}`) };
  }
  return { ok: true, data: parsed.data };
}

/** Turn an upstream failure into a response without leaking internals. */
export function upstreamError(err: unknown): Response {
  if (err instanceof MetaApiError) {
    console.error(err.message);
    const status = err.status === 429 ? 429 : 502;
    return jsonError(
      status,
      status === 429 ? "The model API is rate-limiting us; try again shortly." : "The model API failed.",
    );
  }
  console.error(err);
  return jsonError(500, "Something went wrong on our side.");
}
