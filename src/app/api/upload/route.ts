// Client uploads to Vercel Blob: the browser sends the file straight to Blob (phone videos are far over Vercel's
// 4.5 MB request limit); this route only issues the short-lived upload token, and only with a demo code.
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { demoCodeOf, hasLiveAccess } from "@/server/access";
import { jsonError, LIVE_ACCESS_DENIED, readTextCapped } from "@/server/http";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  if (!hasLiveAccess(demoCodeOf(request))) return LIVE_ACCESS_DENIED();

  let body: HandleUploadBody;
  try {
    body = JSON.parse((await readTextCapped(request, 16_000)) ?? "null") as HandleUploadBody;
  } catch {
    return jsonError(400, "Body must be JSON.");
  }
  // We register no completion callback, so token requests are the only thing this route serves.
  if (typeof body !== "object" || body === null || body.type !== "blob.generate-client-token") {
    return jsonError(400, "Expected an upload token request.");
  }

  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        if (!/^uploads\/[\w.-]{1,120}$/.test(pathname)) throw new Error("Bad upload path.");
        return {
          allowedContentTypes: ["video/mp4", "video/quicktime"],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + 10 * 60 * 1000,
        };
      },
    });
    return Response.json(result);
  } catch (err) {
    console.error(err);
    return jsonError(400, "Couldn't start the upload. Use an MP4 or MOV file under 150 MB.");
  }
}
