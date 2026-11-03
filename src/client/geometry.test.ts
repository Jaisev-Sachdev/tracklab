import { describe, expect, it } from "vitest";
import { containRect, toScreen, toSource } from "./geometry";

const media = { width: 1280, height: 720 };

describe("contain geometry", () => {
  it("letterboxes a wide video in a tall box and pillarboxes in a wide one", () => {
    expect(containRect(media, { width: 640, height: 640 })).toEqual({ x: 0, y: 140, width: 640, height: 360 });
    expect(containRect(media, { width: 1000, height: 360 })).toEqual({ x: 180, y: 0, width: 640, height: 360 });
  });

  it("round-trips points without flooring", () => {
    const box = { width: 640, height: 640 };
    const p = { x: 640.5, y: 100.5 };
    const back = toSource(toScreen(p, media, box), media, box)!;
    expect(back.x).toBeCloseTo(640.5, 9);
    expect(back.y).toBeCloseTo(100.5, 9);
  });

  it("ignores clicks on the letterbox bars", () => {
    expect(toSource({ x: 320, y: 50 }, media, { width: 640, height: 640 })).toBeUndefined();
  });
});
