import "server-only";
import { ALL_FORMATS, Input, UrlSource } from "mediabunny";
import type { SamPrompt, VideoSource } from "@/shared/api";
import { env } from "./env";
import { findSample, sampleVideoDataUrl } from "./samples";

export const SAM_MODEL = "sam-3.1";

export class BadVideoError extends Error {}

/**
 * Whether the Meta API can fetch our static files by URL: a public https origin, and not a Vercel preview, whose
 * deployment protection would answer Meta with 401.
 */
export function canServeToMeta(origin: string): boolean {
  if (env().VERCEL_ENV === "preview") return false;
  const url = new URL(origin);
  if (url.protocol !== "https:") return false;
  const host = url.hostname;
  return !(
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".local")
  );
}

/** Only files uploaded through Tracklab (our Blob store, under uploads/) can be tracked. */
export function isOurUpload(raw: string, host = env().BLOB_PUBLIC_HOST): boolean {
  if (!host) return false;
  const url = new URL(raw);
  return url.protocol === "https:" && url.hostname === host && url.pathname.startsWith("/uploads/") && !url.search;
}

let probedHost: Promise<string | undefined> | undefined;

/**
 * This project's Blob store hostname: BLOB_PUBLIC_HOST if set, otherwise learned once by writing a tiny probe file
 * with the store's own credentials (a read-write token, or Vercel's OIDC token with BLOB_STORE_ID), so deploying
 * needs no hand-copied hostname.
 */
export function blobPublicHost(): Promise<string | undefined> {
  const { BLOB_PUBLIC_HOST, BLOB_READ_WRITE_TOKEN, BLOB_STORE_ID } = env();
  if (BLOB_PUBLIC_HOST) return Promise.resolve(BLOB_PUBLIC_HOST);
  if (!BLOB_READ_WRITE_TOKEN && !BLOB_STORE_ID) return Promise.resolve(undefined);
  probedHost ??= import("@vercel/blob")
    .then(({ put }) =>
      put("uploads/.tracklab-probe.txt", "probe", { access: "public", addRandomSuffix: false, allowOverwrite: true }),
    )
    .then((blob) => new URL(blob.url).hostname)
    .catch((err: unknown) => {
      console.error("Couldn't learn the Blob store host", err);
      probedHost = undefined;
      return undefined;
    });
  return probedHost;
}

export async function videoInput(
  video: VideoSource,
  origin: string,
): Promise<{ type: "input_video"; video_url: string }> {
  if (video.kind === "blob") {
    if (!isOurUpload(video.url, await blobPublicHost())) {
      throw new BadVideoError("Videos must be uploaded through Tracklab.");
    }
    return { type: "input_video", video_url: video.url };
  }
  const sample = findSample(video.id);
  if (!sample) throw new BadVideoError(`Unknown sample "${video.id}".`);
  return {
    type: "input_video",
    video_url: canServeToMeta(origin) ? new URL(sample.video, origin).toString() : sampleVideoDataUrl(sample),
  };
}

/**
 * Read an uploaded video's duration from its container (range requests, not the whole file) and refuse long ones,
 * since SAM bills per frame. The browser checks too, but it can't be trusted.
 */
export async function checkVideoLength(url: string): Promise<number> {
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new BadVideoError("That file has no video track.");
    const seconds = (await track.getDurationFromMetadata()) ?? (await track.computeDuration());
    const max = env().MAX_VIDEO_SECONDS;
    if (!(seconds > 0)) throw new BadVideoError("Couldn't read the video's length.");
    if (seconds > max) {
      throw new BadVideoError(`The video is ${Math.round(seconds)} s long; trim it to ${max} s or less.`);
    }
    return seconds;
  } catch (err) {
    if (err instanceof BadVideoError) throw err;
    throw new BadVideoError("Couldn't read that video. Upload an MP4 or MOV from a phone or camera.");
  } finally {
    input.dispose();
  }
}

export function samRequestBody(
  prompt: SamPrompt,
  media: { type: "input_video"; video_url: string } | { type: "input_image"; image_url: string },
  stream: boolean,
): Record<string, unknown> {
  const text = prompt.kind === "concept" ? prompt.phrase.trim() : prompt.text;
  return {
    model: SAM_MODEL,
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text }, media] }],
    stream,
  };
}
