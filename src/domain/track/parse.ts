// Parse saved SAM 3.1 video output text (as written by the API's output_text lane) into records.
import { parseVideoStream, type ResponsesEvent, type SegmentationRecord } from "@meta-sam/parser";

export type ParsedVideoText = { records: readonly SegmentationRecord[]; diagnostics: number };

export async function parseVideoText(text: string): Promise<ParsedVideoText> {
  async function* events(): AsyncIterable<ResponsesEvent> {
    const lane = { item_id: "saved", output_index: 0, content_index: 0 };
    if (text) yield { type: "response.output_text.delta", ...lane, delta: text };
    yield { type: "response.output_text.done", ...lane, text };
    yield { type: "response.completed" };
  }
  const parsed = parseVideoStream(events());
  for await (const _ of parsed) {
    // Drain snapshots; only the final result matters here.
  }
  const result = await parsed.finalResult;
  if (result.outcome.status !== "completed") throw new Error(`SAM output did not complete: ${result.outcome.status}`);
  return { records: result.records, diagnostics: result.diagnostics.length };
}
