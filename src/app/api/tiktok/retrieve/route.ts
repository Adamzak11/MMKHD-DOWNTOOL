import fsp from "node:fs/promises";
import { handler, HttpError, json, readJson } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { tiktokRetrieveSchema } from "@/server/schemas";
import { getSessionId } from "@/server/session";
import { cachedResolve, downloadTikTok } from "@/server/tiktok/service";
import { parseTikTokUrl } from "@/lib/tiktok-url";
import { createJob, JobStop } from "@/server/jobs";
import { probe } from "@/server/ffprobe";
import { adoptFile, sanitizeName } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request) => {
  const owner = await getSessionId();
  rateLimit(`ttdl:${owner}`, 5, 6);
  const body = tiktokRetrieveSchema.parse(await readJson(req));
  const parsed = parseTikTokUrl(body.url);
  if (!parsed.ok) throw new HttpError(400, parsed.reason || "Invalid URL");
  const entry = cachedResolve(owner, body.url) ?? cachedResolve(owner, parsed.canonical!);
  if (!entry) throw new HttpError(409, "Analyze the link first (or the analysis expired) — then choose a quality.", "resolve_first");
  const { result, handles } = entry;
  if (!result.retrievalAvailable) throw new HttpError(503, result.retrievalNote || "Retrieval unavailable", "not_configured");
  const fmt = result.formats.find((f) => f.id === body.formatId);
  if (!fmt) throw new HttpError(400, "That quality is not available for this video.", "invalid_format");
  if (fmt.watermark !== true && !body.ownerConfirmed) {
    throw new HttpError(
      403,
      fmt.watermark === false
        ? "Watermark-free files are only provided to the video's owner or someone with explicit permission. Confirm ownership/permission, or choose a watermarked format."
        : "The provider does not report whether this format carries TikTok's watermark. It is only provided if you confirm you are the owner or have explicit permission.",
      "ownership_required",
    );
  }

  const title = `TikTok · ${result.metadata.author ? "@" + result.metadata.author : "video"} · ${fmt.label}`;
  const job = createJob(owner, "retrieve", title, async (ctx) => {
    ctx.progress({ phase: "download", phaseLabel: `Retrieving via ${result.provider?.label}`, percent: fmt.filesize ? 0 : null });
    ctx.log("info", `Source: ${result.canonicalUrl} · format ${fmt.label}`);
    const started = Date.now();
    let file: string;
    try {
      file = await downloadTikTok(result.canonicalUrl, fmt.id, handles, ctx.workDir, ctx.signal, (done, total) => {
        const secs = (Date.now() - started) / 1000;
        const rate = secs > 0 ? done / secs : 0;
        ctx.progress({
          percent: total ? Math.round((done / total) * 1000) / 10 : null,
          phaseLabel: `Downloading · ${(done / 1e6).toFixed(2)}${total ? ` / ${(total / 1e6).toFixed(2)}` : ""} MB`,
          speed: rate ? `${(rate / 1e6).toFixed(2)} MB/s` : null,
          etaSec: total && rate ? Math.round((total - done) / rate) : null,
        });
      });
    } catch (err) {
      if (err instanceof HttpError) throw new JobStop(err.message, "failed");
      throw err;
    }
    ctx.progress({ phase: "verify", phaseLabel: "Verifying the downloaded file with FFprobe", percent: null, speed: null, etaSec: null });
    const info = await probe(file, ctx.signal).catch(() => null);
    if (!info?.video) throw new JobStop("The downloaded file is not a valid video. Nothing was saved.", "failed");
    const st = await fsp.stat(file);
    const name = sanitizeName(`tiktok_${result.metadata.author ?? "video"}_${result.videoId ?? "clip"}.mp4`);
    const stored = await adoptFile(file, {
      owner, name, ext: "mp4", kind: "retrieved", info,
      attribution: { source: "TikTok", author: result.metadata.author, title: result.metadata.title, url: result.canonicalUrl },
    });
    ctx.job.retrieve = { fileId: stored.id, info, size: st.size };
    ctx.log("success", `Retrieved ${(st.size / 1e6).toFixed(2)} MB · ${info.video.width}×${info.video.height}`);
  });
  return json(job, { status: 202 });
});
