import { describe, expect, it } from "vitest";
import type { AgentItem } from "@/shared/api";
import { parseReport, pruneImages, runAgent, unverifiedNumbers, type AgentEvent, type StepFn } from "./runner";

const call = (name: string, args: unknown, id = name) => ({
  type: "function_call",
  call_id: id,
  name,
  arguments: JSON.stringify(args),
});
const say = (text: string) => ({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });

/** A scripted model: returns the given outputs in turn and records every conversation it was sent. */
function scripted(outputs: Record<string, unknown>[][]) {
  const seen: AgentItem[][] = [];
  const step: StepFn = async (input) => {
    seen.push(structuredClone(input));
    return { output: outputs[seen.length - 1] ?? [], usage: { input_tokens: 10, output_tokens: 2 } };
  };
  return { step, seen };
}

const report = {
  experiment: "pendulum",
  headline: "g = 9.79 ± 0.04 m/s²",
  summary: "s",
  comparison: "c",
  setup_issues: [],
  next_trial: "n",
};

describe("runAgent", () => {
  it("runs tools, feeds results and images back, and stops at finish", async () => {
    const { step, seen } = scripted([
      [{ type: "reasoning", summary: [] }, say("Looking first."), call("get_frames", { times_s: [0] })],
      [call("finish", report)],
    ]);
    const events: AgentEvent[] = [];
    const result = await runAgent({
      start: "Analyse this.",
      step,
      tools: { get_frames: async () => ({ text: "1 frame", images: ["data:image/jpeg;base64,AA"] }) },
      onEvent: (e) => events.push(e),
      signal: new AbortController().signal,
    });

    expect(result?.headline).toBe(report.headline);
    expect(events.map((e) => e.kind)).toEqual(["usage", "say", "call", "result", "usage", "call", "done"]);
    // Second request: reasoning dropped; assistant text, the call, its output, then the images as a user message.
    expect(seen[1]!.map((i) => ("type" in i && i.type ? i.type : (i as { role: string }).role))).toEqual([
      "user",
      "assistant",
      "function_call",
      "function_call_output",
      "user",
    ]);
  });

  it("reports tool errors to the model, and keeps invented tools out of the conversation the server checks", async () => {
    const outputs = [[call("track", { prompt: "ball" })], [call("nope", {})], [call("finish", report)]];
    const seen: AgentItem[][] = [];
    // Like the server: a function_call to a tool it doesn't define is a 400.
    const step: StepFn = async (input) => {
      seen.push(structuredClone(input));
      if (input.some((i) => "type" in i && i.type === "function_call" && !["track", "finish"].includes(i.name))) {
        throw new Error("400 Unknown tool");
      }
      return { output: outputs[seen.length - 1] ?? [] };
    };
    const results: string[] = [];
    const out = await runAgent({
      start: "go",
      step,
      tools: {
        track: async () => {
          throw new Error("SAM found nothing");
        },
      },
      onEvent: (e) => e.kind === "result" && results.push(e.text),
      signal: new AbortController().signal,
    });
    expect(out?.headline).toBe(report.headline);
    expect(results[0]).toBe("Error: SAM found nothing");
    expect(results[1]).toMatch(/^Error: There is no tool called nope/);
    expect(JSON.stringify(seen[1])).toContain("SAM found nothing");
  });

  it("runs exactly the budgeted tools, asks for finish, then gives up", async () => {
    const loops = Array.from({ length: 10 }, (_, i) => [call("get_frames", {}, `c${i}`)]);
    const { step, seen } = scripted(loops);
    let done: AgentEvent | undefined;
    let ran = 0;
    const result = await runAgent({
      start: "go",
      step,
      tools: { get_frames: async () => ({ text: `ok ${++ran}` }) },
      onEvent: (e) => {
        if (e.kind === "done") done = e;
      },
      signal: new AbortController().signal,
      maxToolCalls: 3,
    });
    expect(result).toBeUndefined();
    expect(ran).toBe(3);
    expect(JSON.stringify(seen[3])).toContain("Tool budget used up");
    expect(done?.kind === "done" && done.reason).toMatch(/ran out of steps/);
  });

  it("sends an incomplete report back instead of showing it", async () => {
    const { step, seen } = scripted([[call("finish", { headline: "g = 9" }, "f1")], [call("finish", report, "f2")]]);
    const out = await runAgent({
      start: "go",
      step,
      tools: {},
      onEvent: () => {},
      signal: new AbortController().signal,
    });
    expect(out?.summary).toBe("s");
    expect(JSON.stringify(seen[1])).toContain("needs at least a headline and a summary");
  });

  it("nudges a model that answers without calling a tool, then stops", async () => {
    const { step, seen } = scripted([[say("Hmm.")], [say("Still thinking.")], [say("…")]]);
    const result = await runAgent({
      start: "go",
      step,
      tools: {},
      onEvent: () => {},
      signal: new AbortController().signal,
    });
    expect(result).toBeUndefined();
    expect(seen).toHaveLength(3);
    expect(JSON.stringify(seen[1])).toContain("Please continue");
  });

  it("stops when aborted", async () => {
    const ctrl = new AbortController();
    const { step } = scripted([[call("track", {})], [call("finish", report)]]);
    const result = await runAgent({
      start: "go",
      step,
      tools: {
        track: async () => {
          ctrl.abort();
          throw new Error("aborted");
        },
      },
      onEvent: () => {},
      signal: ctrl.signal,
    });
    expect(result).toBeUndefined();
  });
});

describe("report checks", () => {
  it("validates and trims the model's report", () => {
    expect(parseReport({ headline: "h" })).toBeUndefined();
    expect(parseReport({ headline: 3, summary: "s" })).toBeUndefined();
    const r = parseReport({ headline: "h", summary: "s", setup_issues: ["a", 4, ""], experiment: "magic" })!;
    expect(r.setup_issues).toEqual(["a"]);
    expect(r.experiment).toBe("other");
  });

  it("flags numbers the report states that no tool produced", () => {
    const r = parseReport({
      headline: "g = 9.799 ± 0.067 m/s²",
      summary: "s",
      comparison: "0.17 σ from 9.81; 1.234 too",
    })!;
    const evidence = ['{"g": "9.799 ± 0.067 m/s²", "sigma": 0.17}'];
    expect(unverifiedNumbers(r, evidence)).toEqual(["1.234"]);
  });
});

describe("pruneImages", () => {
  it("also drops old images when their total size would break the request limit", () => {
    const big = (n: string) => ({
      type: "input_image" as const,
      image_url: `data:image/jpeg;base64,${n}${"A".repeat(1000)}`,
    });
    const items: AgentItem[] = [{ role: "user", content: [big("X"), big("Y"), big("Z")] }];
    const pruned = JSON.stringify(pruneImages(items, 10, 2100));
    expect(pruned).not.toContain("base64,X");
    expect(pruned).toContain("base64,Z");
  });

  it("drops the oldest images first and keeps the newest", () => {
    const img = (n: string) => ({ type: "input_image" as const, image_url: `data:image/jpeg;base64,${n}` });
    const items: AgentItem[] = [
      { role: "user", content: [img("A"), img("B")] },
      { role: "user", content: [img("C"), img("D")] },
    ];
    const pruned = JSON.stringify(pruneImages(items, 3));
    expect(pruned).not.toContain("base64,A");
    expect(pruned).toContain("base64,B");
    expect(pruned).toContain("base64,D");
    expect(pruneImages(items, 4)).toBe(items);
  });
});
