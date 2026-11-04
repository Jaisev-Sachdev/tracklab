// Client uploads to Vercel Blob: the browser sends the file straight to Blob (phone videos are far over Vercel's
// 4.5 MB request limit); this route only authorises the upload, and only with a demo code. It supports both kinds of
// store: a read-write token (classic client tokens) or Vercel's OIDC credentials with BLOB_STORE_ID (presigned URLs).
import { issueSignedToken } from "@vercel/blob";
import {
  handleUpload,
  handleUploadPresigned,
  type HandleUploadBody,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { demoCodeOf, hasLiveAccess } from "@/server/access";
import { env } from "@/server/env";
import { jsonError, LIVE_ACCESS_DENIED, readTextCapped } from "@/server/http";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;
const VIDEO_TYPES = ["video/mp4", "video/quicktime"];
const PATH = /^uploads\/[\w.-]{1,120}$/;

export async function POST(request: Request): Promise<Response> {
  if (!hasLiveAccess(demoCodeOf(request))) return LIVE_ACCESS_DENIED();

  let body: { type?: unknown } | null;
  try {
    body = JSON.parse((await readTextCapped(request, 16_000)) ?? "null") as typeof body;
  } catch {
    return jsonError(400, "Body must be JSON.");
  }
  // We register no completion callback, so authorising an upload is the only thing this route does.
  const kind = typeof body === "object" && body !== null ? body.type : undefined;
  if (kind !== "blob.generate-client-token" && kind !== "blob.generate-presigned-url") {
    return jsonError(400, "Expected an upload authorisation request.");
  }
  const validUntil = Date.now() + 10 * 60 * 1000;

  try {
    if (kind === "blob.generate-client-token") {
      if (!env().BLOB_READ_WRITE_TOKEN) return jsonError(400, "This deployment uses presigned uploads.");
      const result = await handleUpload({
        request,
        body: body as HandleUploadBody,
        onBeforeGenerateToken: async (pathname) => {
          if (!PATH.test(pathname)) throw new Error("Bad upload path.");
          return {
            allowedContentTypes: VIDEO_TYPES,
            maximumSizeInBytes: MAX_UPLOAD_BYTES,
            addRandomSuffix: true,
            validUntil,
          };
        },
      });
      return Response.json(result);
    }
    const result = await handleUploadPresigned({
      request,
      body: body as HandleUploadPresignedBody,
      getSignedToken: async (pathname, _payload, multipart) => {
        if (!PATH.test(pathname) || multipart) throw new Error("Bad upload request.");
        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          validUntil,
          allowedContentTypes: VIDEO_TYPES,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
        });
        return {
          token,
          urlOptions: {
            validUntil,
            allowedContentTypes: VIDEO_TYPES,
            maximumSizeInBytes: MAX_UPLOAD_BYTES,
            addRandomSuffix: true,
          },
        };
      },
    });
    return Response.json(result);
  } catch (err) {
    console.error(err);
    return jsonError(400, "Couldn't start the upload. Use an MP4 or MOV file under 150 MB.");
  }
}
