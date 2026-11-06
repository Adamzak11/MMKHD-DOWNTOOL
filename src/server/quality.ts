import "server-only";
import path from "node:path";
import fsp from "node:fs/promises";
import { config } from "./config";
import { run, runFfmpeg } from "./process";
import { detected } from "./capabilities";
import type { MediaInfo, QualityMetrics } from "@/lib/types";

export function parseSsim(stderr: string) {
  const m = [...stderr.matchAll(/SSIM Y:([\d.]+).*?All:([\d.]+) \(([\d.]+|inf)\)/g)].pop();
  if (!m) return null;
  return { y: parseFloat(m[1]), all: parseFloat(m[2]), db: m[3] === "inf" ? Infinity : parseFloat(m[3]) };
}

export function parsePsnr(stderr: string) {
  const m = [...stderr.matchAll(/PSNR .*?average:([\d.]+|inf) min:([\d.]+|inf)/g)].pop();
  if (!m) return null;
  const f = (s: string) => (s === "inf" ? Infinity : parseFloat(s));
  return { avg: f(m[1]), min: f(m[2]) };
}

export function parseVmaf(stderr: string) {
  const m = [...stderr.matchAll(/VMAF score[:=]\s*([\d.]+)/g)].pop();
  return m ? parseFloat(m[1]) : null;
}

function frameDims(info: MediaInfo) {
  const v = info.video!;
  const rot = v.rotation === 90 || v.rotation === 270;
  return { w: rot ? v.codedHeight : v.codedWidth, h: rot ? v.codedWidth : v.codedHeight };
}

export interface MeasureOptions {
  signal?: AbortSignal;
  vmaf?: boolean;
  onProgress?: (fraction: number | null) => void;
}

/**
 * Compare `distorted` against `reference` with FFmpeg's ssim/psnr (and libvmaf when built in).
 * Long/large videos are measured on evenly spaced segments; the coverage is reported, never hidden.
 */
export async function measureQuality(
  referencePath: string,
  refInfo: MediaInfo,
  distortedPath: string,
  distInfo: MediaInfo,
  opts: MeasureOptions = {},
): Promise<QualityMetrics> {
  const caps = await detected();
  const useVmaf = !!opts.vmaf && caps.filters.has("libvmaf");
  const r = frameDims(refInfo);
  const d = frameDims(distInfo);
  const high = (refInfo.video?.bitDepth ?? 8) > 8 || (distInfo.video?.bitDepth ?? 8) > 8;
  const fmt = high ? "yuv420p10le" : "yuv420p";
  const refFps = refInfo.video?.fps ?? null;
  const distFps = distInfo.video?.fps ?? null;
  const fpsChanged = !!(refFps && distFps && Math.abs(refFps - distFps) / refFps > 0.01);
  const scaled = r.w !== d.w || r.h !== d.h;

  const distChain = [scaled ? `scale=${r.w}:${r.h}:flags=bicubic` : null, `format=${fmt}`, "setpts=PTS-STARTPTS"].filter(Boolean).join(",");
  const refChain = [fpsChanged ? `fps=${distFps}` : null, `format=${fmt}`, "setpts=PTS-STARTPTS"].filter(Boolean).join(",");
  const n = useVmaf ? 3 : 2;
  const labels = (p: string) => Array.from({ length: n }, (_, i) => `[${p}${i}]`).join("");
  let graph = `[0:v]${distChain},split=${n}${labels("d")};[1:v]${refChain},split=${n}${labels("r")};[d0][r0]ssim;[d1][r1]psnr`;
  if (useVmaf) graph += `;[d2][r2]libvmaf=n_threads=4`;

  const duration = Math.min(refInfo.duration, distInfo.duration);
  const workload = r.w * r.h * (refFps ?? 30) * duration;
  const FULL_LIMIT = 1920 * 1080 * 30 * 120; // ≈ 2 minutes of 1080p30
  const segLen = 2;
  const segments: number[] = [];
  if (workload > FULL_LIMIT && duration > segLen * 10) {
    const count = 8;
    for (let i = 0; i < count; i++) segments.push(((i + 0.5) * duration) / count - segLen / 2);
  }

  const threads = config.ffmpegThreads ? ["-threads", String(config.ffmpegThreads)] : [];
  const runOne = async (start: number | null, len: number | null, base: number, span: number) => {
    const seek = (p: string) => (start !== null ? ["-ss", start.toFixed(3), "-t", String(len), "-i", p] : ["-i", p]);
    const { stderr } = await runFfmpeg([...threads, ...seek(distortedPath), ...seek(referencePath), "-lavfi", graph, "-an", "-f", "null", "-"], {
      signal: opts.signal,
      durationSec: len ?? duration,
      stderrLimit: 200_000,
      onProgress: (p) => opts.onProgress?.(p.fraction === null ? null : base + p.fraction * span),
    });
    return { ssim: parseSsim(stderr), psnr: parsePsnr(stderr), vmaf: useVmaf ? parseVmaf(stderr) : null };
  };

  const results = segments.length
    ? await (async () => {
        const out = [];
        for (let i = 0; i < segments.length; i++) out.push(await runOne(Math.max(0, segments[i]), segLen, i / segments.length, 1 / segments.length));
        return out;
      })()
    : [await runOne(null, null, 0, 1)];

  const mean = (xs: (number | null | undefined)[]) => {
    const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const allInf = results.every((x) => x.psnr && x.psnr.avg === Infinity);
  const ssim = mean(results.map((x) => x.ssim?.all));
  const ssimY = mean(results.map((x) => x.ssim?.y));
  const ssimDbVals = results.map((x) => x.ssim?.db);
  const psnr = allInf ? Infinity : mean(results.map((x) => x.psnr?.avg));
  const psnrMins = results.map((x) => x.psnr?.min).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const notes: string[] = [];
  if (scaled) notes.push(`Output was scaled back to ${r.w}×${r.h} (bicubic) for comparison; scores include the resolution change.`);
  if (fpsChanged) notes.push(`Source was resampled to ${distFps?.toFixed(2)} FPS for frame alignment; scores are approximate.`);
  if (opts.vmaf && !useVmaf) notes.push("VMAF unavailable: this FFmpeg build has no libvmaf filter.");
  const coverage = segments.length
    ? `${segments.length} × ${segLen}s evenly spaced segments (≈${Math.round(((segments.length * segLen) / duration) * 100)}% of the video)`
    : "every frame";

  return {
    ssim: ssim === null ? null : Math.min(1, ssim),
    ssimY,
    ssimDb: ssimDbVals.some((x) => x === Infinity) && ssimDbVals.every((x) => x === Infinity) ? Infinity : mean(ssimDbVals),
    psnr: psnr === Infinity ? 999 : psnr,
    psnrMin: psnrMins.length ? Math.min(...psnrMins) : allInf ? 999 : null,
    vmaf: mean(results.map((x) => x.vmaf)),
    coverage,
    note: notes.length ? notes.join(" ") : null,
  };
}

/** Hash every decoded video frame (in the source pixel format) and compare — proof of a lossless encode. */
export async function verifyLossless(sourcePath: string, outputPath: string, pixFmt: string, workDir: string, signal?: AbortSignal) {
  const hash = async (input: string, name: string) => {
    const out = path.join(workDir, `${name}.md5`);
    await run(config.ffmpeg, ["-hide_banner", "-nostdin", "-y", "-i", input, "-map", "0:v:0", "-fps_mode", "passthrough", "-pix_fmt", pixFmt, "-f", "hash", "-hash", "md5", out], { signal });
    return (await fsp.readFile(out, "utf8")).trim();
  };
  const [a, b] = await Promise.all([hash(sourcePath, "src"), hash(outputPath, "out")]);
  return { match: a === b && a.length > 0, source: a, output: b };
}
