// Smoke test for a deployment's upload path: upload a bundled sample through /api/upload exactly as the browser
// does, then ask SAM to track the uploaded copy. Bills one short SAM call (about 120 frames).
// Usage: tsx scripts/smoke-upload.ts <base-url> <demo-code> [token|presigned]
import { readFileSync } from "node:fs";
import { upload, uploadPresigned } from "@vercel/blob/client";

const [base, code, mode = "presigned"] = process.argv.slice(2);
if (!base || !code) throw new Error("usage: smoke-upload.ts <base-url> <demo-code> [token|presigned]");

const file = new File([readFileSync("public/samples/collision-synthetic.mp4")], "smoke-test.mp4", {
  type: "video/mp4",
});
const options = {
  access: "public" as const,
  handleUploadUrl: `${base}/api/upload`,
  headers: { "x-demo-code": code },
};
const started = Date.now();
const blob =
  mode === "token"
    ? await upload("uploads/smoke-test.mp4", file, options)
    : await uploadPresigned("uploads/smoke-test.mp4", file, options);
console.log(`uploaded in ${Date.now() - started} ms: ${blob.url}`);

const res = await fetch(`${base}/api/sam/track`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-demo-code": code },
  body: JSON.stringify({ video: { kind: "blob", url: blob.url }, prompt: { kind: "concept", phrase: "blue ball" } }),
});
const text = await res.text();
console.log(
  `track: HTTP ${res.status}, ${(text.match(/output_text\.delta/g) ?? []).length} deltas, ` +
    `completed: ${text.includes("response.completed")}${res.ok ? "" : `, ${text.slice(0, 300)}`}`,
);
