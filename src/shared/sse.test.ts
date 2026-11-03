import { parseVideoStream, type ResponsesEvent } from "@meta-sam/parser";
import { describe, expect, it } from "vitest";
import { fixture } from "../../test/synthetic";
import { parseVideoText } from "@/domain/track/parse";
import { readSse, replayOutputText, sseChunk } from "./sse";

/** A byte stream that delivers `text` in chunks of `size` bytes, to exercise split events. */
function streamOf(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(i, i + size));
      i += size;
    },
  });
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe("readSse", () => {
  it("reassembles events split across chunks and skips non-data lines and [DONE]", async () => {
    const text = `event: x\n${sseChunk({ type: "a", n: 1 })}: comment\n\n${sseChunk({ type: "b" })}data: [DONE]\n\n`;
    const events = await collect(readSse(streamOf(text, 3)));
    expect(events).toEqual([{ type: "a", n: 1 }, { type: "b" }]);
  });

  it("cancels the stream when the consumer stops early", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new TextEncoder().encode(sseChunk({ type: "tick" })));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const ev of readSse(body)) {
      expect(ev.type).toBe("tick");
      break;
    }
    expect(cancelled).toBe(true);
  });

  it("handles CRLF line endings and a final event without a trailing blank line", async () => {
    const events = await collect(readSse(streamOf('data: {"type":"a"}\r\n\r\ndata: {"type":"b"}', 5)));
    expect(events.map((e) => e.type)).toEqual(["a", "b"]);
  });
});

describe("replayOutputText", () => {
  it("replays saved SAM output so the parser sees the same records as the live stream would give", async () => {
    const saved = fixture("sam-collision-synthetic.txt");
    const events = readSse(streamOf(replayOutputText(saved), 4096));
    const parsed = parseVideoStream(events as AsyncIterable<ResponsesEvent>);
    await collect(parsed);
    const result = await parsed.finalResult;
    expect(result.outcome.status).toBe("completed");
    expect(result.records).toEqual((await parseVideoText(saved)).records);
  });

  it("replays an empty result (no matches) as a completed stream", async () => {
    const parsed = parseVideoStream(readSse(streamOf(replayOutputText(""), 64)) as AsyncIterable<ResponsesEvent>);
    await collect(parsed);
    const result = await parsed.finalResult;
    expect(result.outcome.status).toBe("completed");
    expect(result.records).toHaveLength(0);
  });
});
