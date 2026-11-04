// The lab-partner loop: send the conversation to Muse Spark (one step at a time through our API), run each tool it
// calls here in the browser, and feed the results back until it calls `finish`.
import { MAX_AGENT_IMAGES, type AgentItem } from "@/shared/api";

export type ToolResult = { text: string; images?: string[] };
export type ToolHandler = (args: Record<string, unknown>, signal: AbortSignal) => Promise<ToolResult>;

export type FinishReport = {
  experiment: "pendulum" | "collision" | "freefall" | "other";
  headline: string;
  summary: string;
  comparison: string;
  setup_issues: string[];
  next_trial: string;
  /** Decimal numbers in the headline or comparison that appear in no tool result or note (set by the runner). */
  unverifiedNumbers?: string[];
};

/** The model's `finish` arguments, checked: free-form JSON must not reach the UI unvalidated. */
export function parseReport(args: Record<string, unknown>): FinishReport | undefined {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const headline = str(args.headline, 200);
  const summary = str(args.summary, 1500);
  if (!headline || !summary) return undefined;
  const kinds = ["pendulum", "collision", "freefall", "other"] as const;
  const experiment = kinds.find((k) => k === args.experiment) ?? "other";
  const issues = Array.isArray(args.setup_issues) ? args.setup_issues : [];
  return {
    experiment,
    headline,
    summary,
    comparison: str(args.comparison, 500),
    setup_issues: issues
      .map((s) => str(s, 300))
      .filter(Boolean)
      .slice(0, 5),
    next_trial: str(args.next_trial, 500),
  };
}

/**
 * Decimal numbers the report states that no tool result or note contains. A measured value must come from our
 * code, so anything else is shown to the person as unverified rather than silently trusted.
 */
export function unverifiedNumbers(report: FinishReport, evidence: readonly string[]): string[] {
  const known = [...(evidence.join("\n").match(/\d+(?:\.\d+)?/g) ?? []).map(Number), 9.81];
  // A stated number counts as measured if some measured number rounds to it at the stated precision (9.480 → 9.48).
  const matches = (s: string) => {
    const decimals = s.split(".")[1]?.length ?? 0;
    const v = Number(s);
    return known.some((k) => Math.abs(Number(k.toFixed(decimals)) - v) < 1e-9);
  };
  const stated = `${report.headline}\n${report.comparison}`.match(/\d+\.\d+/g) ?? [];
  return [...new Set(stated.filter((n) => !matches(n)))];
}

export type AgentEvent =
  | { kind: "say"; text: string }
  | { kind: "call"; id: string; name: string; args: Record<string, unknown> }
  | { kind: "result"; id: string; name: string; text: string; images: string[]; error: boolean }
  | { kind: "usage"; inputTokens: number; outputTokens: number }
  | { kind: "done"; report: FinishReport | undefined; reason: string };

export type StepFn = (
  input: AgentItem[],
  signal: AbortSignal,
) => Promise<{ output: Record<string, unknown>[]; usage?: Record<string, unknown> }>;

export type RunOptions = {
  start: string;
  step: StepFn;
  tools: Record<string, ToolHandler>;
  onEvent: (e: AgentEvent) => void;
  signal: AbortSignal;
  maxToolCalls?: number;
  /** Images kept in the conversation; older frame images are replaced with a note (the server allows 24). */
  maxImages?: number;
};

/** Keep the request under Vercel's 4.5 MB body limit with room for the text. */
export const MAX_IMAGE_CHARS = 3_200_000;

/**
 * Replace images in the oldest messages with a note until at most `max` remain and their data URLs total at most
 * `maxChars` characters.
 */
export function pruneImages(items: AgentItem[], max: number, maxChars = MAX_IMAGE_CHARS): AgentItem[] {
  const sizes: number[] = [];
  for (const item of items) {
    if ("role" in item && item.role === "user" && Array.isArray(item.content)) {
      for (const p of item.content) if (p.type === "input_image") sizes.push(p.image_url.length);
    }
  }
  // Drop from the oldest until both limits hold.
  let drop = 0;
  let chars = sizes.reduce((s, v) => s + v, 0);
  while (drop < sizes.length && (sizes.length - drop > max || chars > maxChars)) chars -= sizes[drop++]!;
  if (drop === 0) return items;
  return items.map((item) => {
    if (drop <= 0 || !("role" in item) || item.role !== "user" || !Array.isArray(item.content)) return item;
    const content = item.content.map((p) => {
      if (drop > 0 && p.type === "input_image") {
        drop--;
        return { type: "input_text" as const, text: "[older frame image removed to save space]" };
      }
      return p;
    });
    return { ...item, content };
  });
}

const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .filter((p): p is { type: string; text: string } => typeof p?.text === "string")
        .map((p) => p.text)
        .join("")
    : typeof content === "string"
      ? content
      : "";

export async function runAgent(opts: RunOptions): Promise<FinishReport | undefined> {
  const { step, tools, onEvent, signal } = opts;
  const maxToolCalls = opts.maxToolCalls ?? 16;
  const maxImages = Math.min(opts.maxImages ?? 20, MAX_AGENT_IMAGES);
  let items: AgentItem[] = [{ role: "user", content: [{ type: "input_text", text: opts.start }] }];
  // Everything the report may quote numbers from: the person's notes and successful tool results.
  const evidence: string[] = [opts.start];
  let toolCalls = 0;
  let nudges = 0;

  for (;;) {
    if (signal.aborted) {
      onEvent({ kind: "done", report: undefined, reason: "Stopped." });
      return undefined;
    }
    items = pruneImages(items, maxImages);
    let res: Awaited<ReturnType<StepFn>>;
    try {
      res = await step(items, signal);
    } catch (e) {
      if (!signal.aborted) throw e;
      onEvent({ kind: "done", report: undefined, reason: "Stopped." });
      return undefined;
    }
    const usage = res.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    if (usage) onEvent({ kind: "usage", inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 });

    let called = false;
    for (const out of res.output) {
      if (out.type === "message" && out.role === "assistant") {
        const text = textOf(out.content).trim();
        if (text) {
          items.push({ role: "assistant", content: text });
          onEvent({ kind: "say", text });
        }
        continue;
      }
      if (out.type !== "function_call") continue; // reasoning items are not sent back (store: false)
      called = true;
      const name = String(out.name);
      const id = String(out.call_id);
      const rawArgs = typeof out.arguments === "string" ? out.arguments : "{}";

      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(rawArgs);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
      } catch {
        // Leave args empty; the tool will report what's missing.
      }
      onEvent({ kind: "call", id, name, args });

      // The server only accepts calls to tools it defines, so an invented one must not enter the conversation.
      if (name !== "finish" && !tools[name]) {
        const text = `There is no tool called ${name}. Use one of: ${[...Object.keys(tools), "finish"].join(", ")}.`;
        onEvent({ kind: "result", id, name, text: `Error: ${text}`, images: [], error: true });
        items.push({ role: "user", content: [{ type: "input_text", text }] });
        continue;
      }
      if (name !== "finish" && toolCalls >= maxToolCalls) {
        onEvent({ kind: "done", report: undefined, reason: "The lab partner ran out of steps without a report." });
        return undefined;
      }
      items.push({ type: "function_call", call_id: id, name, arguments: rawArgs });

      if (name === "finish") {
        const report = parseReport(args);
        if (!report) {
          items.push({
            type: "function_call_output",
            call_id: id,
            output: "Error: the report needs at least a headline and a summary. Call finish again with every field.",
          });
          onEvent({ kind: "result", id, name, text: "Error: incomplete report", images: [], error: true });
          toolCalls++;
          continue;
        }
        report.unverifiedNumbers = unverifiedNumbers(report, evidence);
        items.push({ type: "function_call_output", call_id: id, output: "Report shown to the person." });
        onEvent({ kind: "done", report, reason: "Finished." });
        return report;
      }

      let result: ToolResult;
      let error = false;
      const handler = tools[name]!;
      try {
        result = await handler(args, signal);
      } catch (e) {
        if (signal.aborted) {
          onEvent({ kind: "done", report: undefined, reason: "Stopped." });
          return undefined;
        }
        error = true;
        result = { text: `Error: ${e instanceof Error ? e.message : String(e)}` };
      }
      toolCalls++;
      const images = result.images ?? [];
      if (!error) evidence.push(result.text);
      onEvent({ kind: "result", id, name, text: result.text, images, error });
      items.push({ type: "function_call_output", call_id: id, output: result.text });
      // Images go in a user message right after the tool output, which every Responses-compatible API accepts.
      if (images.length > 0) {
        items.push({
          role: "user",
          content: [
            { type: "input_text", text: `Images returned by ${name} (call ${id}), in the order requested.` },
            ...images.map((image_url) => ({ type: "input_image" as const, image_url })),
          ],
        });
      }
      if (toolCalls === maxToolCalls) {
        items.push({
          role: "user",
          content: [{ type: "input_text", text: "Tool budget used up. Call finish now with what you have." }],
        });
      }
    }

    if (!called) {
      if (++nudges > 2) {
        onEvent({ kind: "done", report: undefined, reason: "The lab partner stopped without a report." });
        return undefined;
      }
      items.push({
        role: "user",
        content: [{ type: "input_text", text: "Please continue: call a tool, or call finish with the report." }],
      });
    }
  }
}
