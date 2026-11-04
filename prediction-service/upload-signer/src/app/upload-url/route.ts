import { type HandleUploadBody, handleUpload } from "@vercel/blob/client";

/**
 * Issues a short-lived token for one direct upload from the browser to the private Blob
 * store. A plan is larger than a function may receive, so its bytes never pass through here.
 *
 * It lives in Next because the Python Blob SDK cannot issue these. The rules do not: this
 * route asks the API, with the visitor's own cookie, whether the upload is allowed and on
 * what terms. A visitor who is not logged in gets no token.
 */
const TOKEN_LIFETIME_MS = 15 * 60 * 1000;

async function uploadPermit(request: Request, projectId: string, pathname: string) {
  const backend = (process.env.BACKEND_URL ?? "").replace(/\/$/, "");
  const response = await fetch(`${backend}/api/projects/${encodeURIComponent(projectId)}/documents/upload-permit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: request.headers.get("cookie") ?? "" },
    body: JSON.stringify({ pathname }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("ההעלאה לא אושרה");
  return (await response.json()) as { content_type: string; max_bytes: number };
}

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, projectId) => {
        const permit = await uploadPermit(request, projectId ?? "", pathname);
        return {
          allowedContentTypes: [permit.content_type],
          maximumSizeInBytes: permit.max_bytes,
          validUntil: Date.now() + TOKEN_LIFETIME_MS,
          addRandomSuffix: false,
          allowOverwrite: false,
        };
      },
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "ההעלאה נכשלה" }, { status: 400 });
  }
}
