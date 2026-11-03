import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MAX_AGENT_IMAGES, type AgentItem } from "@/shared/api";
import { env } from "./env";

const AGENT = path.join(process.cwd(), "content", "agent");

/** Output tokens per step, reasoning included. A step is a short message plus one tool call, or the final report. */
export const MAX_OUTPUT_TOKENS = 6000;

let content: { instructions: string; tools: { name: string }[] } | undefined;

/** The agent's instructions and tool definitions, kept as data files in content/agent/. */
export function agentContent(): { instructions: string; tools: { name: string }[] } {
  content ??= {
    instructions: readFileSync(path.join(AGENT, "instructions.md"), "utf8"),
    tools: JSON.parse(readFileSync(path.join(AGENT, "tools.json"), "utf8")) as { name: string }[],
  };
  return content;
}

/** Count image parts anywhere in the input (in messages or in function_call_output content). */
export function countImages(input: unknown): number {
  if (Array.isArray(input)) return input.reduce<number>((n, v) => n + countImages(v), 0);
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    return (obj.type === "input_image" ? 1 : 0) + Object.values(obj).reduce<number>((n, v) => n + countImages(v), 0);
  }
  return 0;
}

export class AgentInputError extends Error {}

/**
 * One agent step: the browser sends the conversation so far (already allowlisted by `AgentStepRequest`); the server
 * fixes the model, instructions and tools, so the route can't run with different instructions.
 */
export function agentRequestBody(input: AgentItem[]): Record<string, unknown> {
  if (countImages(input) > MAX_AGENT_IMAGES) {
    throw new AgentInputError(`Too many images in one analysis (max ${MAX_AGENT_IMAGES}).`);
  }
  const { instructions, tools } = agentContent();
  const names = new Set(tools.map((t) => t.name));
  const unknown = input.find((item) => item.type === "function_call" && !names.has(item.name));
  if (unknown?.type === "function_call") throw new AgentInputError(`Unknown tool "${unknown.name}".`);

  const { SPARK_MODEL, SPARK_REASONING_EFFORT } = env();
  return {
    model: SPARK_MODEL,
    instructions,
    tools,
    input,
    reasoning: { effort: SPARK_REASONING_EFFORT },
    max_output_tokens: MAX_OUTPUT_TOKENS,
    parallel_tool_calls: false,
    store: false,
  };
}
