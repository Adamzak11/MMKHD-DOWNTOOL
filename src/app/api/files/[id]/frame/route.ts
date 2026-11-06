import { config } from "@/server/config";
import { handler, HttpError } from "@/server/http";
import { spawn } from "node:child_process";
import { rateLimit } from "@/server/ratelimit";
import { getSessionId } from "@/server/session";
import { getOwnedFile, mediaPath } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Decode one exact frame at time `t` as a lossless PNG at native resolution.
 * Used for 100% zoom inspection — independent of what codecs the browser can play.
 */
export const GET = handler(async (req: Request, { params }: Ctx) => {
  const owner = await getSessionId();
  rateLimit(`frame:${owner}`, 40, 120);
  const meta = await getOwnedFile((await params).id, owner);
  const t = Number(new URL(req.url).searchParams.get("t") ?? "0");
  const dur = meta.info?.duration ?? 0;
  if (!Number.isFinite(t) || t < 0) throw new HttpError(400, "Invalid time");
  const at = Math.min(t, Math.max(0, dur - 0.05));
  const png = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    {
      const child = spawn(config.ffmpeg, ["-hide_banner", "-nostdin", "-v", "error", "-ss", at.toFixed(3), "-i", mediaPath(meta), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"], { stdio: ["ignore", "pipe", "pipe"] });
      const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
      child.stdout.on("data", (d: Buffer) => chunks.push(d));
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0 && chunks.length) resolve(Buffer.concat(chunks));
        else reject(new HttpError(500, "Could not extract a frame at that time"));
      });
    }
  });
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=600" } });
});
