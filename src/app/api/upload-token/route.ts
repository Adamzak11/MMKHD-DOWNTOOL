import { handler, json } from "@/server/http";
import { getSessionId } from "@/server/session";
import { rateLimit } from "@/server/ratelimit";
import { createUploadToken } from "@/server/upload-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const owner = await getSessionId();
  rateLimit(`uptok:${owner}`, 20, 30);
  return json({ token: createUploadToken(owner) });
});
