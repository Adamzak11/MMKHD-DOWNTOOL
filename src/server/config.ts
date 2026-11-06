import "server-only";
import path from "node:path";
import crypto from "node:crypto";

function num(name: string, def: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return def;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : def;
}

function bool(name: string, def = false): boolean {
  const raw = process.env[name];
  if (!raw) return def;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

let generatedSecret: string | null = null;

export const config = {
  dataDir: path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.DATA_DIR || "data"),
  ffmpeg: process.env.FFMPEG_PATH || "ffmpeg",
  ffprobe: process.env.FFPROBE_PATH || "ffprobe",
  ytdlp: process.env.YTDLP_PATH || "yt-dlp",
  maxUploadBytes: num("MAX_UPLOAD_MB", 2048, 1) * 1_000_000,
  maxDownloadBytes: num("MAX_DOWNLOAD_MB", 500, 1) * 1_000_000,
  maxDurationSec: num("MAX_DURATION_SEC", 900, 1),
  jobTimeoutMs: num("JOB_TIMEOUT_SEC", 3600, 30) * 1000,
  maxConcurrentJobs: Math.max(1, Math.floor(num("MAX_CONCURRENT_JOBS", 1, 1))),
  maxQueuedPerSession: Math.max(1, Math.floor(num("MAX_QUEUED_JOBS_PER_SESSION", 3, 1))),
  fileTtlMs: num("FILE_TTL_MIN", 60, 1) * 60_000,
  ffmpegThreads: Math.floor(num("FFMPEG_THREADS", 0, 0)),
  tiktok: {
    providerUrl: process.env.TIKTOK_PROVIDER_URL || "",
    providerToken: process.env.TIKTOK_PROVIDER_TOKEN || "",
    ytdlpEnabled: bool("TIKTOK_YTDLP_ENABLED", false),
  },
  get sessionSecret(): string {
    const s = process.env.SESSION_SECRET;
    if (s && s.length >= 16) return s;
    if (!generatedSecret) {
      generatedSecret = crypto.randomBytes(32).toString("hex");
      if (process.env.NODE_ENV === "production") {
        console.warn("[mamatkilat] SESSION_SECRET not set — using a random per-process secret. Sessions reset on restart.");
      }
    }
    return generatedSecret;
  },
};

/** Size unit used everywhere in the product: 1 MB = 1,000,000 bytes (decimal). */
export const MB = 1_000_000;
