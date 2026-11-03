import "server-only";
import { z } from "zod";

const Env = z.object({
  MODEL_API_KEY: z.string().min(1, "MODEL_API_KEY is not set (see .env.example)"),
  /** Comma-separated codes that unlock live calls. Unset in development means "open"; in production it means "closed". */
  DEMO_CODES: z.string().optional(),
  SPARK_MODEL: z.string().default("muse-spark-1.3"),
  SPARK_REASONING_EFFORT: z.enum(["minimal", "low", "medium", "high", "xhigh"]).default("low"),
  NODE_ENV: z.string().default("development"),
  /** Set by Vercel: "production", "preview" or "development". */
  VERCEL_ENV: z.string().optional(),
  /**
   * Hostname of this project's Blob store, e.g. "abc123.public.blob.vercel-storage.com" (the host of any uploaded
   * file's URL). Uploaded videos are only tracked if they live there; unset means uploads can't be tracked.
   */
  BLOB_PUBLIC_HOST: z
    .string()
    .regex(/^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/)
    .optional(),
  /** Longest video SAM will be asked to track, in seconds. SAM bills per frame. */
  MAX_VIDEO_SECONDS: z.coerce.number().positive().default(60),
});
export type Env = z.infer<typeof Env>;

let cached: Env | undefined;

export function env(): Env {
  cached ??= Env.parse(process.env);
  return cached;
}

/** For tests: forget the parsed environment. */
export function resetEnvForTests(): void {
  cached = undefined;
}
