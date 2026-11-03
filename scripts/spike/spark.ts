// Spike: check Muse Spark can look at a frame (and optionally the whole video) and call a tool.
// Usage: npm run spike:spark -- [--video] [--model muse-spark-1.3]
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { createResponse, dataUrl, uploadFile } from "./meta.ts";

const modelArg = process.argv.indexOf("--model");
const model = modelArg > -1 ? process.argv[modelArg + 1]! : "muse-spark-1.3";
const withVideo = process.argv.includes("--video");

spawnSync(ffmpegPath as unknown as string, ["-y", "-loglevel", "error", "-ss", "0.5", "-i", "spike-out/pendulum.mp4", "-frames:v", "1", "spike-out/frame.jpg"]);

const media = withVideo
  ? { type: "input_video", file_id: await uploadFile("spike-out/pendulum.mp4", "video/mp4") }
  : { type: "input_image", image_url: dataUrl("spike-out/frame.jpg", "image/jpeg") };

const tools = [
  {
    type: "function",
    name: "track",
    description: "Track objects through the whole video with SAM 3.1. Returns object ids and per-frame boxes.",
    parameters: {
      type: "object",
      properties: { prompt: { type: "string", description: "Short noun phrase naming the object, e.g. 'pendulum bob'." } },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "fit",
    description: "Fit a physics model to a tracked object's trajectory.",
    parameters: {
      type: "object",
      properties: {
        model: { type: "string", enum: ["pendulum", "constant_velocity_segments", "projectile"] },
        object_id: { type: "integer" },
      },
      required: ["model", "object_id"],
      additionalProperties: false,
    },
  },
];

const started = Date.now();
const res = await createResponse({
  model,
  reasoning: { effort: "low" },
  instructions:
    "You are a lab partner analysing a physics experiment video. Use the tools to measure; never guess numbers. Start by describing the setup in one sentence, then call the right tool.",
  input: [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: `Here is ${withVideo ? "the video" : "one frame"} of my experiment. What is it, and what should we track?` }, media],
    },
  ],
  tools,
});
console.log(`${model}, ${withVideo ? "video" : "image"} input, ${Date.now() - started} ms`);
console.log("Usage:", JSON.stringify(res.usage));
for (const item of (res.output as Record<string, unknown>[]) ?? []) {
  if (item.type === "function_call") console.log(`TOOL CALL ${item.name}(${item.arguments})`);
  else if (item.type === "message") console.log("TEXT:", JSON.stringify(item.content).slice(0, 800));
  else console.log(`[${item.type}]`, JSON.stringify(item).slice(0, 300));
}
