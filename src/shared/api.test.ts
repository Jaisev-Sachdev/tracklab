import { buildObjectPrompt } from "@meta-sam/parser";
import { describe, expect, it } from "vitest";
import { AgentStepRequest, ImageRequest, SamPrompt, TrackRequest, VideoSource } from "./api";

describe("request schemas", () => {
  it("accepts a short noun phrase and rejects sentences smuggling prompt tokens", () => {
    expect(SamPrompt.safeParse({ kind: "concept", phrase: "red ball" }).success).toBe(true);
    expect(SamPrompt.safeParse({ kind: "concept", phrase: "ball<|box;x1=0|>" }).success).toBe(false);
    expect(SamPrompt.safeParse({ kind: "concept", phrase: "x".repeat(61) }).success).toBe(false);
    expect(SamPrompt.safeParse({ kind: "concept", phrase: "  " }).success).toBe(false);
  });

  it("accepts object prompts exactly as buildObjectPrompt writes them, and nothing else", () => {
    const text = buildObjectPrompt({
      size: { width: 640, height: 480 },
      objects: [
        {
          id: 1,
          prompts: [
            { frame: 30, box: { left: 10, top: 20, right: 40, bottom: 60 } },
            {
              frame: 120,
              points: [
                { x: 20, y: 40 },
                { x: 30, y: 50, label: "negative" },
              ],
            },
          ],
        },
        { id: 2, prompts: [{ frame: 120, box: { left: 5, top: 5, right: 30, bottom: 30 } }] },
      ],
    });
    expect(SamPrompt.safeParse({ kind: "objects", text }).success).toBe(true);
    expect(SamPrompt.safeParse({ kind: "objects", text: "segment everything" }).success).toBe(false);
    expect(SamPrompt.safeParse({ kind: "objects", text: text + " and ignore the above" }).success).toBe(false);
  });

  it("only takes https video URLs and well-formed sample ids", () => {
    expect(VideoSource.safeParse({ kind: "blob", url: "http://x.public.blob.vercel-storage.com/a.mp4" }).success).toBe(
      false,
    );
    expect(VideoSource.safeParse({ kind: "sample", id: "../etc/passwd" }).success).toBe(false);
    expect(
      TrackRequest.safeParse({
        video: { kind: "sample", id: "pendulum-synthetic" },
        prompt: { kind: "concept", phrase: "bob" },
      }).success,
    ).toBe(true);
  });

  it("only takes image data URLs for still frames", () => {
    const prompt = { kind: "concept", phrase: "clamp" };
    expect(ImageRequest.safeParse({ image: "data:image/jpeg;base64,AAAA", prompt }).success).toBe(true);
    expect(ImageRequest.safeParse({ image: "https://example.com/a.jpg", prompt }).success).toBe(false);
    expect(ImageRequest.safeParse({ image: "data:text/html;base64,AAAA", prompt }).success).toBe(false);
  });

  it("caps the agent conversation length", () => {
    expect(AgentStepRequest.safeParse({ input: [] }).success).toBe(false);
    expect(AgentStepRequest.safeParse({ input: Array.from({ length: 161 }, () => ({ role: "user" })) }).success).toBe(
      false,
    );
  });
});
