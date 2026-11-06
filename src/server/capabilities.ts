import "server-only";
import { config } from "./config";
import { run } from "./process";
import type { Capabilities } from "@/lib/types";

interface Detected {
  ffmpegVersion: string | null;
  encoders: Set<string>;
  filters: Set<string>;
  ytdlpVersion: string | null;
  at: number;
}

const g = globalThis as unknown as { __mkCaps?: Promise<Detected> };

async function detect(): Promise<Detected> {
  const encoders = new Set<string>();
  const filters = new Set<string>();
  let ffmpegVersion: string | null = null;
  try {
    const v = await run(config.ffmpeg, ["-hide_banner", "-version"], { collectStdout: true, timeoutMs: 15_000 });
    ffmpegVersion = v.stdout.match(/ffmpeg version (\S+)/)?.[1] ?? null;
    const e = await run(config.ffmpeg, ["-hide_banner", "-encoders"], { collectStdout: true, timeoutMs: 15_000 });
    for (const line of e.stdout.split("\n")) {
      const m = line.match(/^\s[VAS.][A-Z.]{5}\s+(\S+)/);
      if (m) encoders.add(m[1]);
    }
    const f = await run(config.ffmpeg, ["-hide_banner", "-filters"], { collectStdout: true, timeoutMs: 15_000 });
    for (const line of f.stdout.split("\n")) {
      const m = line.match(/^\s[T.][S.][C.]\s+(\S+)/);
      if (m) filters.add(m[1]);
    }
  } catch (err) {
    console.error("[mamatkilat] FFmpeg detection failed:", (err as Error).message);
  }
  let ytdlpVersion: string | null = null;
  if (config.tiktok.ytdlpEnabled) {
    try {
      const y = await run(config.ytdlp, ["--version"], { collectStdout: true, timeoutMs: 15_000 });
      ytdlpVersion = y.stdout.trim() || null;
    } catch {
      ytdlpVersion = null;
    }
  }
  return { ffmpegVersion, encoders, filters, ytdlpVersion, at: Date.now() };
}

export async function detected(): Promise<Detected> {
  if (!g.__mkCaps) g.__mkCaps = detect();
  const d = await g.__mkCaps;
  if (Date.now() - d.at > 10 * 60_000) g.__mkCaps = detect();
  return d;
}

export async function getCapabilities(): Promise<Capabilities> {
  const d = await detected();
  const av1Encoder = d.encoders.has("libsvtav1") ? "libsvtav1" : d.encoders.has("libaom-av1") ? "libaom-av1" : null;
  const providers: Capabilities["tiktok"]["providers"] = [
    {
      id: "api",
      label: "Authorized media provider",
      enabled: !!config.tiktok.providerUrl,
      reason: config.tiktok.providerUrl ? undefined : "TIKTOK_PROVIDER_URL is not configured",
    },
    {
      id: "ytdlp",
      label: "Public-page extractor (yt-dlp, operator opt-in)",
      enabled: config.tiktok.ytdlpEnabled && !!d.ytdlpVersion,
      reason: !config.tiktok.ytdlpEnabled
        ? "Disabled by the operator (TIKTOK_YTDLP_ENABLED=false)"
        : !d.ytdlpVersion
          ? "yt-dlp binary not found on the server"
          : undefined,
    },
  ];
  return {
    ffmpegVersion: d.ffmpegVersion,
    encoders: {
      h264: d.encoders.has("libx264"),
      h265: d.encoders.has("libx265"),
      av1: !!av1Encoder,
      av1Encoder,
      ffv1: d.encoders.has("ffv1"),
      aac: d.encoders.has("aac"),
      alac: d.encoders.has("alac"),
    },
    metrics: { ssim: d.filters.has("ssim"), psnr: d.filters.has("psnr"), vmaf: d.filters.has("libvmaf") },
    limits: {
      maxUploadMB: Math.round(config.maxUploadBytes / 1e6),
      maxDurationSec: config.maxDurationSec,
      fileTtlMin: Math.round(config.fileTtlMs / 60_000),
      maxDownloadMB: Math.round(config.maxDownloadBytes / 1e6),
    },
    tiktok: { oembed: true, providers },
  };
}
