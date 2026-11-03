// Server-sent events: read a Responses API event stream, and write one.

export type StreamEvent = { type: string; [key: string]: unknown };

/** Yields each JSON event in an SSE byte stream. Ignores comments, `event:` lines and the `[DONE]` sentinel. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buf += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buf = buf.replace(/\r\n/g, "\n");
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const event = parseBlock(buf.slice(0, sep));
        buf = buf.slice(sep + 2);
        if (event) yield event;
      }
      if (done) break;
    }
    finished = true;
    const tail = parseBlock(buf);
    if (tail) yield tail;
  } finally {
    // A consumer that stops early must not leave the stream (and the billed SAM call behind it) running.
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function parseBlock(block: string): StreamEvent | undefined {
  const data = block
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return undefined;
  return JSON.parse(data) as StreamEvent;
}

export const sseChunk = (event: StreamEvent) => `data: ${JSON.stringify(event)}\n\n`;

/**
 * SSE text replaying saved SAM output as the API streams it: one `output_text.delta` per frame line, then `done` and
 * `completed`.
 */
export function replayOutputText(text: string): string {
  const lane = { item_id: "replay", output_index: 0, content_index: 0 };
  const lines = text.split(/(?<=\n)/).filter((l) => l.length > 0);
  return [
    ...lines.map((delta) => sseChunk({ type: "response.output_text.delta", ...lane, delta })),
    sseChunk({ type: "response.output_text.done", ...lane, text }),
    sseChunk({ type: "response.completed", response: { status: "completed" } }),
  ].join("");
}
