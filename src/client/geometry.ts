// Mapping between video source pixels and the on-screen box the video is drawn into with object-fit: contain.

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** Where a `media`-sized frame lands inside a `box`-sized element under object-fit: contain. */
export function containRect(media: Size, box: Size): Rect {
  const scale = Math.min(box.width / media.width, box.height / media.height);
  const width = media.width * scale;
  const height = media.height * scale;
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
}

/** Source pixels -> element pixels. */
export function toScreen(p: { x: number; y: number }, media: Size, box: Size): { x: number; y: number } {
  const r = containRect(media, box);
  return { x: r.x + (p.x * r.width) / media.width, y: r.y + (p.y * r.height) / media.height };
}

/**
 * Element pixels -> continuous source coordinates (pixel i spans [i, i + 1), so a click in its middle is i + 0.5).
 * Deliberately not floored: mask centroids are continuous, and flooring a pivot click biases the length by half a
 * pixel. Returns undefined outside the picture.
 */
export function toSource(p: { x: number; y: number }, media: Size, box: Size): { x: number; y: number } | undefined {
  const r = containRect(media, box);
  const x = ((p.x - r.x) * media.width) / r.width;
  const y = ((p.y - r.y) * media.height) / r.height;
  if (x < 0 || y < 0 || x > media.width || y > media.height) return undefined;
  return { x, y };
}
