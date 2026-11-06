import "server-only";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "../config";
import { HttpError } from "../http";
import { run, ProcessError } from "../process";
import { getCapabilities } from "../capabilities";
import { parseTikTokUrl, isTikTokHost } from "@/lib/tiktok-url";
import type { TikTokFormat, TikTokResolveResult } from "@/lib/types";

const UA = "MamatkilatVideoTools/1.0 (+oEmbed client)";

/** Follow a vm./vt. short link to its canonical video URL — only ever to TikTok hosts (SSRF guard). */
export async function expandShortLink(url: string): Promise<string> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    let res: Response;
    try {
      res = await fetch(current, { method: "GET", redirect: "manual", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new HttpError(502, "Network failure: could not reach TikTok to expand the short link.", "network");
    }
    await res.body?.cancel().catch(() => {});
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      const next = new URL(loc, current);
      if (next.protocol !== "https:" || !isTikTokHost(next.hostname)) throw new HttpError(400, "The short link redirects outside TikTok — refusing to follow it.", "unsupported");
      current = next.toString();
      const parsed = parseTikTokUrl(current);
      if (parsed.ok && parsed.kind === "video") return parsed.canonical!;
      continue;
    }
    if (res.status === 404) throw new HttpError(404, "This short link does not point to an existing video (it may be deleted).", "not_found");
    break;
  }
  throw new HttpError(422, "Could not resolve the short link to a TikTok video.", "unsupported");
}

interface OEmbed {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
}

/** TikTok's official, public oEmbed endpoint. Returns metadata only — never media. */
export async function fetchOEmbed(canonical: string): Promise<OEmbed> {
  let res: Response;
  try {
    res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(canonical)}`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new HttpError(502, "Network failure: could not reach TikTok's oEmbed service. Check the server's network access and try again.", "network");
  }
  if (res.status === 400 || res.status === 404) {
    throw new HttpError(404, "TikTok returned no public video for this link. It may be private, deleted, age/region restricted, or the link is wrong. Private and restricted videos are not supported.", "unavailable");
  }
  if (res.status === 429) throw new HttpError(503, "TikTok is rate-limiting requests right now. Try again in a minute.", "upstream_rate_limited");
  if (!res.ok) throw new HttpError(502, `TikTok oEmbed responded with HTTP ${res.status}.`, "upstream");
  const data = (await res.json().catch(() => null)) as OEmbed | null;
  if (!data) throw new HttpError(502, "TikTok oEmbed returned an unreadable response.", "upstream");
  return data;
}

// ── Media providers ────────────────────────────────────────────────────

interface ProviderResolve {
  formats: TikTokFormat[];
  /** formats with their private retrieval handle (never sent to the client) */
  handles: Record<string, { url?: string; headers?: Record<string, string> }>;
  duration: number | null;
  title?: string | null;
  author?: string | null;
  thumbnail?: string | null;
}

interface Provider {
  id: "api" | "ytdlp";
  label: string;
  resolve(url: string): Promise<ProviderResolve>;
  download(url: string, formatId: string, handle: ProviderResolve["handles"][string] | undefined, outPath: string, signal: AbortSignal, onProgress: (done: number, total: number | null) => void): Promise<void>;
}

function mapYtdlpError(stderr: string): HttpError {
  const s = stderr.toLowerCase();
  if (s.includes("private")) return new HttpError(403, "This video is private. Private videos cannot be retrieved.", "private");
  if (s.includes("login") || s.includes("age") || s.includes("sign in")) return new HttpError(403, "This video is restricted (login/age gated) and cannot be retrieved.", "restricted");
  if (s.includes("geo") || s.includes("country") || s.includes("region")) return new HttpError(403, "This video is region-restricted and cannot be retrieved from this server's location.", "restricted");
  if (s.includes("removed") || s.includes("not available") || s.includes("unavailable") || s.includes("404")) return new HttpError(404, "This video is unavailable or has been deleted.", "unavailable");
  if (s.includes("unable to download") || s.includes("timed out") || s.includes("connection") || s.includes("network")) return new HttpError(502, "Network failure while contacting TikTok.", "network");
  if (s.includes("unsupported url")) return new HttpError(422, "The extractor does not support this URL.", "unsupported");
  return new HttpError(502, "The source could not be retrieved by the extractor.", "unavailable_source");
}

const ytdlpProvider: Provider = {
  id: "ytdlp",
  label: "Public-page extractor (yt-dlp)",
  async resolve(url) {
    let out: string;
    try {
      out = (await run(config.ytdlp, ["-J", "--no-playlist", "--no-warnings", "--skip-download", "--", url], { collectStdout: true, timeoutMs: 45_000 })).stdout;
    } catch (err) {
      throw err instanceof ProcessError ? mapYtdlpError(err.stderrTail || err.message) : err;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j: any = JSON.parse(out);
    if (j.availability && j.availability !== "public") throw new HttpError(403, `This video is ${j.availability} and cannot be retrieved.`, "restricted");
    const formats: TikTokFormat[] = [];
    const handles: ProviderResolve["handles"] = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const f of j.formats || []) {
      if (!f.format_id || f.vcodec === "none" || f.acodec === "none") continue; // only complete (muxed) files
      const note = `${f.format_note || ""} ${f.format_id}`.toLowerCase();
      const watermark = note.includes("watermark") ? true : null;
      formats.push({
        id: String(f.format_id).slice(0, 80),
        label: [f.height ? `${f.height}p` : null, f.vcodec && f.vcodec !== "none" ? String(f.vcodec).split(".")[0] : null, f.format_note || null].filter(Boolean).join(" · ") || f.format_id,
        width: f.width ?? null,
        height: f.height ?? null,
        ext: f.ext || "mp4",
        filesize: f.filesize ?? f.filesize_approx ?? null,
        watermark,
        vcodec: f.vcodec ?? null,
        bitrateKbps: f.tbr ? Math.round(f.tbr) : null,
      });
    }
    formats.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0));
    return { formats, handles, duration: j.duration ?? null, title: j.title ?? j.description ?? null, author: j.uploader ?? j.creator ?? null, thumbnail: j.thumbnail ?? null };
  },
  async download(url, formatId, _h, outPath, signal, onProgress) {
    try {
      await run(
        config.ytdlp,
        [
          "-f", formatId, "-o", outPath, "--no-playlist", "--no-part", "--no-mtime", "--newline", "--no-warnings",
          "--max-filesize", String(config.maxDownloadBytes),
          "--progress-template", "download:MKP %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s",
          "--", url,
        ],
        {
          signal,
          timeoutMs: 15 * 60_000,
          onStdoutLine: (line) => {
            const m = line.match(/^MKP (\d+) (\S+) (\S+)/);
            if (!m) return;
            const total = Number(m[2]) || Number(m[3]) || null;
            onProgress(Number(m[1]), total);
          },
        },
      );
    } catch (err) {
      if (err instanceof ProcessError) throw mapYtdlpError(err.stderrTail || err.message);
      throw err;
    }
    const st = await fsp.stat(outPath).catch(() => null);
    if (!st || st.size === 0) throw new HttpError(502, "The extractor finished without producing a file (the size limit may have been exceeded).", "unavailable_source");
  },
};

/**
 * Generic contract for a licensed / authorized provider (see README):
 *   POST {TIKTOK_PROVIDER_URL}  { "url": "<tiktok url>" }   Authorization: Bearer <token>
 *   → { title?, author?, duration?, thumbnail?, formats: [{ id, url, width?, height?, ext?, filesize?, watermark?, vcodec?, bitrate_kbps? }] }
 */
const apiProvider: Provider = {
  id: "api",
  label: "Authorized media provider",
  async resolve(url) {
    let res: Response;
    try {
      res = await fetch(config.tiktok.providerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...(config.tiktok.providerToken ? { Authorization: `Bearer ${config.tiktok.providerToken}` } : {}) },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new HttpError(502, "Network failure: the authorized provider could not be reached.", "network");
    }
    if (res.status === 404) throw new HttpError(404, "The provider reports this video is unavailable or deleted.", "unavailable");
    if (res.status === 403) throw new HttpError(403, "The provider reports this video is private or restricted.", "restricted");
    if (!res.ok) throw new HttpError(502, `The authorized provider responded with HTTP ${res.status}.`, "upstream");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j: any = await res.json().catch(() => null);
    if (!j || !Array.isArray(j.formats)) throw new HttpError(502, "The authorized provider returned an invalid response.", "upstream");
    const formats: TikTokFormat[] = [];
    const handles: ProviderResolve["handles"] = {};
    for (const f of j.formats) {
      if (typeof f?.id !== "string" || typeof f?.url !== "string" || !/^https:\/\//.test(f.url)) continue;
      const id = f.id.slice(0, 80);
      handles[id] = { url: f.url };
      formats.push({
        id,
        label: [f.height ? `${f.height}p` : null, f.vcodec ?? null, f.watermark === false ? "no watermark" : f.watermark === true ? "watermarked" : null].filter(Boolean).join(" · ") || id,
        width: typeof f.width === "number" ? f.width : null,
        height: typeof f.height === "number" ? f.height : null,
        ext: typeof f.ext === "string" ? f.ext : "mp4",
        filesize: typeof f.filesize === "number" ? f.filesize : null,
        watermark: typeof f.watermark === "boolean" ? f.watermark : null,
        vcodec: typeof f.vcodec === "string" ? f.vcodec : null,
        bitrateKbps: typeof f.bitrate_kbps === "number" ? f.bitrate_kbps : null,
      });
    }
    formats.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
    return { formats, handles, duration: typeof j.duration === "number" ? j.duration : null, title: j.title ?? null, author: j.author ?? null, thumbnail: j.thumbnail ?? null };
  },
  async download(_url, _id, handle, outPath, signal, onProgress) {
    if (!handle?.url) throw new HttpError(400, "Unknown format", "invalid_format");
    let res: Response;
    try {
      res = await fetch(handle.url, { signal, headers: handle.headers });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new HttpError(502, "Network failure while downloading from the provider.", "network");
    }
    if (!res.ok || !res.body) throw new HttpError(502, `Provider media download failed (HTTP ${res.status}).`, "upstream");
    const total = Number(res.headers.get("content-length")) || null;
    if (total && total > config.maxDownloadBytes) throw new HttpError(413, `The video is larger than the ${Math.round(config.maxDownloadBytes / 1e6)} MB download limit.`, "too_large");
    let done = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        done += chunk.length;
        if (done > config.maxDownloadBytes) return cb(new HttpError(413, "Download exceeded the size limit.", "too_large"));
        onProgress(done, total);
        cb(null, chunk);
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pipeline(Readable.fromWeb(res.body as any), counter, fs.createWriteStream(outPath), { signal });
  },
};

export async function activeProvider(): Promise<Provider | null> {
  const caps = await getCapabilities();
  const on = (id: string) => caps.tiktok.providers.find((p) => p.id === id)?.enabled;
  if (on("api")) return apiProvider;
  if (on("ytdlp")) return ytdlpProvider;
  return null;
}

// Cache resolve results so the download step only accepts format ids the server itself returned.
interface CacheEntry { at: number; owner: string; result: TikTokResolveResult; handles: ProviderResolve["handles"] }
const g = globalThis as unknown as { __mkTT?: Map<string, CacheEntry> };
const cache: Map<string, CacheEntry> = (g.__mkTT ??= new Map<string, CacheEntry>());

export function cachedResolve(owner: string, canonical: string) {
  const e = cache.get(`${owner}|${canonical}`);
  if (!e || Date.now() - e.at > 15 * 60_000) return null;
  return e;
}

export async function resolveTikTok(owner: string, input: string): Promise<TikTokResolveResult> {
  const parsed = parseTikTokUrl(input);
  if (!parsed.ok) throw new HttpError(400, parsed.reason || "Invalid TikTok URL", "invalid_url");
  let canonical = parsed.canonical!;
  if (parsed.kind === "short") canonical = await expandShortLink(canonical);
  const again = parseTikTokUrl(canonical);
  const oembed = await fetchOEmbed(canonical);

  const provider = await activeProvider();
  let formats: TikTokFormat[] = [];
  let handles: ProviderResolve["handles"] = {};
  let duration: number | null = null;
  let retrievalNote: string | null = null;
  let extra: Partial<ProviderResolve> = {};
  if (!provider) {
    retrievalNote =
      "Media retrieval is not configured on this server. Metadata above comes from TikTok's official oEmbed API, which does not provide video files. The operator must configure an authorized provider (TIKTOK_PROVIDER_URL) — see the README. If you are the creator, you can also save your own video from the TikTok app and upload it to the Compressor.";
  } else {
    const r = await provider.resolve(canonical);
    formats = r.formats;
    handles = r.handles;
    duration = r.duration;
    extra = r;
    if (!formats.length) retrievalNote = "The provider returned no complete video formats for this post.";
  }
  const result: TikTokResolveResult = {
    canonicalUrl: canonical,
    videoId: again.videoId,
    metadata: {
      title: oembed.title?.trim() || extra.title || null,
      author: oembed.author_name || extra.author || null,
      authorUrl: oembed.author_url || null,
      thumbnailUrl: oembed.thumbnail_url || extra.thumbnail || null,
      duration,
      source: provider ? `TikTok oEmbed + ${provider.label}` : "TikTok oEmbed (official)",
    },
    provider: provider ? { id: provider.id, label: provider.label } : null,
    formats,
    retrievalAvailable: !!provider && formats.length > 0,
    retrievalNote,
  };
  cache.set(`${owner}|${canonical}`, { at: Date.now(), owner, result, handles });
  return result;
}

export async function downloadTikTok(
  canonical: string, formatId: string, handles: CacheEntry["handles"], workDir: string, signal: AbortSignal, onProgress: (done: number, total: number | null) => void,
) {
  const provider = await activeProvider();
  if (!provider) throw new HttpError(503, "Media retrieval is not configured on this server.", "not_configured");
  const out = path.join(workDir, "retrieved.mp4");
  await provider.download(canonical, formatId, handles[formatId], out, signal, onProgress);
  return out;
}
