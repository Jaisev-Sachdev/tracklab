import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nearestFrame } from "./frames";
import { makeTools, type LabContext } from "./tools";

describe("agent tools", () => {
  it("implements every tool the model is offered (finish is handled by the runner)", () => {
    const defined = (
      JSON.parse(readFileSync(path.join(process.cwd(), "content", "agent", "tools.json"), "utf8")) as { name: string }[]
    ).map((t) => t.name);
    const implemented = Object.keys(makeTools({} as LabContext));
    expect([...implemented, "finish"].sort()).toEqual([...defined].sort());
  });

  it("finds the nearest frame to a time, on uneven frame times too", () => {
    const times = [0, 0.033, 0.07, 0.1, 0.134];
    expect(nearestFrame(times, 0)).toBe(0);
    expect(nearestFrame(times, 0.06)).toBe(2);
    expect(nearestFrame(times, 0.051)).toBe(1);
    expect(nearestFrame(times, 9)).toBe(4);
    expect(nearestFrame(times, -1)).toBe(0);
  });
});
