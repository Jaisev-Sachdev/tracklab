// Spike: probe SAM 3.1 on a single frame with several prompts, to separate "bad request shape" from "no match".
// Usage: tsx --env-file-if-exists=.env.local scripts/spike/sam-image.ts <image> <prompt> [<prompt>...]
import { dataUrl, streamResponse } from "./meta.ts";

const [image, ...prompts] = process.argv.slice(2);
if (!image || prompts.length === 0) throw new Error("usage: sam-image.ts <image> <prompt>...");
const mime = image.endsWith(".png") ? "image/png" : "image/jpeg";

for (const prompt of prompts) {
  let text = "";
  for await (const ev of streamResponse({
    model: "sam-3.1",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: dataUrl(image, mime) }] }],
  })) {
    if (ev.type === "response.output_text.delta") text += String(ev.delta);
    if (ev.type === "response.output_text.done" && !text) text = String(ev.text ?? "");
  }
  console.log(`"${prompt}": ${text ? text.slice(0, 200) : "(no match)"}`);
}
