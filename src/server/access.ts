import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { DEMO_CODE_HEADER } from "@/shared/api";
import { env } from "./env";

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * Whether this request may make billed calls (live SAM, Muse Spark, uploads). Codes come from DEMO_CODES. With no
 * codes configured, development is open and production is closed, so a missing env var never opens the bill.
 */
export function hasLiveAccess(code: string | null | undefined): boolean {
  const { DEMO_CODES, NODE_ENV } = env();
  const codes = (DEMO_CODES ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (codes.length === 0) return NODE_ENV !== "production";
  if (!code) return false;
  const given = digest(code.trim());
  // Compare every code so timing doesn't reveal which (if any) matched.
  return codes.reduce((ok, c) => timingSafeEqual(digest(c), given) || ok, false);
}

export const demoCodeOf = (request: Request) => request.headers.get(DEMO_CODE_HEADER);
