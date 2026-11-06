import { handler, json, readJson } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { tiktokResolveSchema } from "@/server/schemas";
import { getSessionId } from "@/server/session";
import { resolveTikTok } from "@/server/tiktok/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request) => {
  const owner = await getSessionId();
  rateLimit(`tt:${owner}`, 10, 10);
  const { url } = tiktokResolveSchema.parse(await readJson(req));
  return json(await resolveTikTok(owner, url));
});
