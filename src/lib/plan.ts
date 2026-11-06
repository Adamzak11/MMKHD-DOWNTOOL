/**
 * Pure planning logic for the Smart Video Compressor.
 * Shared by the server (authoritative) and the client (live calculator preview).
 * Nothing in here touches FFmpeg; it turns facts about the source into a plan.
 */
import type {
  BudgetBreakdown,
  Capabilities,
  CompressRequest,
  CompressionPlan,
  Feasibility,
  MediaInfo,
  PlanAlternative,
  QualityPreference,
  VideoCodecChoice,
} from "./types";

export const MB = 1_000_000;
/** Spec: average video bitrate must stay below 10 Mbps. */
export const MAX_AVG_BITRATE = 10_000_000;
export const SIZE_PRESETS_MB = [5, 8, 9.5, 10] as const;
export const DEFAULT_TARGET_MB = 9.5;
export const DEFAULT_AUDIO_KBPS = 128;

/** Relative bitrate needed vs H.264 for similar perceptual quality (rule of thumb, not a guarantee). */
export const CODEC_EFFICIENCY: Record<VideoCodecChoice, number> = { h264: 1, h265: 0.65, av1: 0.55 };

/** Quality-targeted CRF per codec and preference. */
export const CRF_TABLE: Record<VideoCodecChoice, Record<QualityPreference, number>> = {
  h264: { high: 18, balanced: 21, max: 25 },
  h265: { high: 20, balanced: 23, max: 27 },
  av1: { high: 27, balanced: 32, max: 38 },
};

/**
 * Quality Guard thresholds. SSIM (All channels, 0–1) is the gate;
 * PSNR / VMAF are reported alongside but are different scales and are never converted into each other.
 */
export const QUALITY_THRESHOLDS: Record<QualityPreference, { ssim: number; label: string }> = {
  high: { ssim: 0.96, label: "High — SSIM ≥ 0.960" },
  balanced: { ssim: 0.93, label: "Balanced — SSIM ≥ 0.930" },
  max: { ssim: 0.88, label: "Maximum compression — SSIM ≥ 0.880" },
};

export const MP4_AUDIO_COPYABLE = new Set(["aac", "mp3", "alac", "opus", "flac", "ac3", "eac3"]);
export const MP4_VIDEO_COPYABLE = new Set(["h264", "hevc", "av1"]);

export const X264_LOSSLESS_PIXFMTS = new Set([
  "yuv420p", "yuvj420p", "yuv422p", "yuvj422p", "yuv444p", "yuvj444p", "nv12", "gray",
  "yuv420p10le", "yuv422p10le", "yuv444p10le", "gray10le",
]);

export function formatMbps(bps: number) {
  return bps >= 1e6 ? `${(bps / 1e6).toFixed(2)} Mbps` : `${Math.round(bps / 1e3)} kbps`;
}

/**
 * Minimum output resolution (short side). Output is never scaled below 1080p;
 * sources that are already smaller keep their native resolution (never upscaled).
 */
export const MIN_OUTPUT_SHORT_SIDE = 1080;

/** Output dimensions for a requested short-side resolution. Never upscales, never below 1080p; keeps aspect ratio; even sizes. */
export function outputDims(srcW: number, srcH: number, shortSide: number | null) {
  const srcShort = Math.min(srcW, srcH);
  if (shortSide) shortSide = Math.max(shortSide, MIN_OUTPUT_SHORT_SIDE);
  if (!shortSide || shortSide >= srcShort) return { width: srcW, height: srcH, scaled: false };
  const scale = shortSide / srcShort;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(srcW * scale), height: even(srcH * scale), scaled: true };
}

/** Hard byte limit for the output: the user's target, tightened by the 10 Mbps average-bitrate rule. */
export function sizeLimitBytes(targetBytes: number, durationSec: number) {
  return Math.min(targetBytes, Math.floor((MAX_AVG_BITRATE * 0.995 * durationSec) / 8));
}

export function containerOverheadBps(durationSec: number, fps: number, audioSampleRate: number | null) {
  // MP4 sample tables cost ~10–12 bytes per sample (video frames + AAC frames of 1024 samples),
  // plus a fixed header. Doubled to stay conservative.
  const audioFramesPerSec = audioSampleRate ? audioSampleRate / 1024 : 0;
  const perSecond = (fps + audioFramesPerSec) * 12 * 8;
  const fixed = (16 * 1024 * 8) / Math.max(durationSec, 0.5);
  return Math.round((perSecond + fixed) * 2);
}

export function computeBudget(args: {
  targetBytes: number;
  durationSec: number;
  audioBps: number;
  outWidth: number;
  outHeight: number;
  outFps: number;
  audioSampleRate: number | null;
  maxVideoBps?: number | null;
}): BudgetBreakdown {
  const { targetBytes, durationSec, audioBps, outWidth, outHeight, outFps } = args;
  // The spec caps the AVERAGE bitrate at 10 Mbps, so short clips get a smaller effective size limit.
  const totalBps = Math.min((targetBytes * 8) / durationSec, MAX_AVG_BITRATE * 0.99);
  const overheadBps = containerOverheadBps(durationSec, outFps, args.audioSampleRate);
  const safetyBps = Math.round(totalBps * 0.02); // rate-control variance; actual size is verified afterwards
  let videoBps = Math.floor(totalBps - audioBps - overheadBps - safetyBps);
  const cap = args.maxVideoBps ?? Infinity;
  if (videoBps > cap) videoBps = Math.floor(cap);
  const bitsPerPixel = videoBps > 0 ? videoBps / (outWidth * outHeight * outFps) : 0;
  return {
    targetBytes,
    durationSec,
    totalBps: Math.round(totalBps),
    audioBps,
    overheadBps,
    safetyBps,
    videoBps,
    bitsPerPixel,
    outWidth,
    outHeight,
    outFps,
  };
}

export function feasibilityFor(bpp: number, videoBps: number, codec: VideoCodecChoice): Feasibility {
  if (videoBps < 60_000) return "unrealistic";
  const eff = bpp / CODEC_EFFICIENCY[codec]; // H.264-equivalent bits per pixel
  if (eff >= 0.1) return "comfortable";
  if (eff >= 0.06) return "good";
  if (eff >= 0.035) return "tight";
  if (eff >= 0.012) return "very-tight";
  return "unrealistic";
}

export const FEASIBILITY_TEXT: Record<Feasibility, string> = {
  comfortable: "Plenty of bitrate for this resolution and frame rate. Expect results very close to the source.",
  good: "Enough bitrate for good quality. Fine detail in fast motion may soften slightly.",
  tight: "Tight budget. Detailed or high-motion scenes will likely lose some sharpness.",
  "very-tight": "Very tight budget. Visible compression artifacts are likely at this resolution — the Quality Guard may reject the result.",
  unrealistic: "Not realistic at this resolution and frame rate: the bitrate budget is too small to keep watchable quality.",
};

export interface AudioDecision {
  action: "copy" | "aac" | "none" | "alac";
  bps: number;
  label: string;
}

export function decideAudio(req: Pick<CompressRequest, "audio" | "mode">, info: MediaInfo, container: "mp4" | "mkv"): AudioDecision {
  const a = info.audio;
  if (!a) return { action: "none", bps: 0, label: "Source has no audio track" };
  if (req.audio.mode === "remove") return { action: "none", bps: 0, label: "Audio removed (your choice)" };
  const chosen = Math.round(Math.min(Math.max(req.audio.bitrateKbps || DEFAULT_AUDIO_KBPS, 32), 320) * 1000);
  const copyable = container === "mkv" || MP4_AUDIO_COPYABLE.has(a.codec);
  if (req.mode === "lossless") {
    if (copyable) return { action: "copy", bps: a.bitrate ?? 0, label: `Copied bit-exact (${a.codec.toUpperCase()})` };
    return { action: "alac", bps: (a.sampleRate ?? 48000) * (a.channels ?? 2) * 16 * 0.6, label: "Decoded and stored losslessly as ALAC" };
  }
  if (req.audio.mode === "copy") {
    if (copyable && a.bitrate) return { action: "copy", bps: a.bitrate, label: `Copied without re-encoding (${a.codec.toUpperCase()} ${formatMbps(a.bitrate)})` };
    return { action: "aac", bps: chosen, label: `AAC ${chosen / 1000} kbps (source ${a.codec} cannot be copied into MP4 with a known bitrate)` };
  }
  if (req.audio.mode === "auto" && a.codec === "aac" && a.bitrate && !a.bitrateEstimated && a.bitrate <= chosen * 1.05) {
    return { action: "copy", bps: a.bitrate, label: `Copied without re-encoding (AAC ${formatMbps(a.bitrate)} — already within budget)` };
  }
  return { action: "aac", bps: chosen, label: `AAC ${chosen / 1000} kbps` };
}

export function recommendCodec(
  requested: VideoCodecChoice | "auto",
  bpp: number,
  videoBps: number,
  caps: Pick<Capabilities, "encoders"> | null,
): { codec: VideoCodecChoice; reason: string } {
  const has = (c: VideoCodecChoice) => (caps ? caps.encoders[c] : true);
  if (requested !== "auto") {
    if (!has(requested)) {
      return { codec: "h264", reason: `${requested.toUpperCase()} encoder is not available on this server — using H.264 instead.` };
    }
    const why: Record<VideoCodecChoice, string> = {
      h264: "H.264 selected — plays everywhere.",
      h265: "H.265 selected — better compression; some browsers (e.g. Firefox, Chrome on Linux) cannot play HEVC.",
      av1: "AV1 selected — highest efficiency, slow to encode; needs a recent device/browser.",
    };
    return { codec: requested, reason: why[requested] };
  }
  const f = feasibilityFor(bpp, videoBps, "h264");
  if ((f === "comfortable" || f === "good") || !has("h265")) {
    return { codec: "h264", reason: "H.264 recommended — the bitrate budget is sufficient, and H.264 has the widest compatibility." };
  }
  return {
    codec: "h265",
    reason: "H.265 recommended — the budget is tight for H.264; HEVC typically needs ~35% less bitrate for similar quality. Plays on iOS, macOS, Android and Windows; some desktop browsers cannot preview it.",
  };
}

function srcFps(info: MediaInfo) {
  return info.video?.fps ?? 30;
}

export function buildAlternatives(info: MediaInfo, req: CompressRequest, audioBps: number, codec: VideoCodecChoice, caps: Pick<Capabilities, "encoders"> | null): PlanAlternative[] {
  const v = info.video;
  if (!v || !info.duration) return [];
  const targetMB = req.mode === "custom" && req.custom?.targetSizeMB ? req.custom.targetSizeMB : req.targetSizeMB;
  const targetBytes = targetMB * MB;
  const fps = req.custom?.fps ?? srcFps(info);
  const sr = info.audio?.sampleRate ?? null;
  const alts: PlanAlternative[] = [];
  const est = (w: number, h: number, f: number, a: number, c: VideoCodecChoice) => {
    const b = computeBudget({ targetBytes, durationSec: info.duration, audioBps: a, outWidth: w, outHeight: h, outFps: f, audioSampleRate: sr });
    return { b, f: feasibilityFor(b.bitsPerPixel, b.videoBps, c) };
  };
  const base = { mode: "custom" as const, qualityPreference: req.qualityPreference };
  const customBase = { codec: req.codec, targetSizeMB: targetMB, maxBitrateKbps: null, resolution: req.custom?.resolution ?? null, fps: req.custom?.fps ?? null };

  if (codec === "h264" && (!caps || caps.encoders.h265)) {
    const r = est(v.width, v.height, fps, audioBps, "h265");
    alts.push({ label: "Switch to H.265", description: `Same resolution & FPS, ~35% more efficient → ${r.f.replace("-", " ")}. Reduced browser compatibility.`, apply: { ...base, custom: { ...customBase, codec: "h265" } } });
  }
  const short = Math.min(v.width, v.height);
  for (const s of [1440, 1080].filter((x) => x >= MIN_OUTPUT_SHORT_SIDE)) {
    if (s >= short) continue;
    const d = outputDims(v.width, v.height, s);
    const r = est(d.width, d.height, fps, audioBps, codec);
    alts.push({ label: `Downscale to ${s}p`, description: `${d.width}×${d.height} at the same FPS → ${r.f.replace("-", " ")} (${r.b.bitsPerPixel.toFixed(3)} bpp).`, apply: { ...base, custom: { ...customBase, codec, resolution: s } } });
    if (r.f === "comfortable" || r.f === "good") break;
  }
  if (fps > 31) {
    const r = est(v.width, v.height, 30, audioBps, codec);
    alts.push({ label: "Reduce to 30 FPS", description: `Halves the frames to encode → ${r.f.replace("-", " ")}. Motion will look less fluid.`, apply: { ...base, custom: { ...customBase, codec, fps: 30 } } });
  }
  if (info.audio && audioBps > 96_000) {
    alts.push({ label: "Lower audio to 96 kbps", description: `Frees ${formatMbps(audioBps - 96_000)} for video. AAC at 96 kbps is still clear for speech and most music.`, apply: { audio: { mode: "aac", bitrateKbps: 96 } } });
  }
  // Size needed for "good" quality at source resolution with the chosen codec.
  const neededBpp = 0.06 * CODEC_EFFICIENCY[codec];
  const neededVideo = neededBpp * v.width * v.height * fps;
  const neededBytes = ((neededVideo + audioBps) * info.duration) / 8 / 0.97;
  const neededMB = Math.ceil((neededBytes / MB) * 10) / 10;
  if (neededMB > targetMB) {
    alts.push({ label: `Raise target to ${neededMB} MB`, description: `Keeps source resolution & FPS with good expected quality using ${codec.toUpperCase()}.`, apply: { targetSizeMB: neededMB, custom: { ...customBase, targetSizeMB: neededMB } } });
  }
  return alts;
}

export function buildPlan(req: CompressRequest, info: MediaInfo, caps: Pick<Capabilities, "encoders"> | null): CompressionPlan {
  const v = info.video;
  const warnings: string[] = [];
  if (!v) {
    return {
      mode: req.mode, codec: "h264", codecReason: "", container: "mp4", strategy: "No video stream found", budget: null,
      feasibility: "unrealistic", feasibilityNote: "The file has no video stream.", audioPlan: "", pixFmtPlan: "", warnings, alternatives: [], canRemux: false,
    };
  }
  const srcPix = v.pixFmt ?? "yuv420p";

  // ── Lossless ─────────────────────────────────────────────────────────
  if (req.mode === "lossless") {
    const want = req.lossless?.container ?? "auto";
    const x264ok = X264_LOSSLESS_PIXFMTS.has(srcPix) && (!caps || caps.encoders.h264);
    const container: "mp4" | "mkv" = want === "mkv" ? "mkv" : want === "mp4" && x264ok ? "mp4" : x264ok ? "mp4" : "mkv";
    if (want === "mp4" && !x264ok) warnings.push(`Pixel format ${srcPix} is not supported by lossless H.264 — using FFV1 in MKV instead.`);
    const audio = decideAudio(req, info, container);
    warnings.push("Lossless encoding preserves every decoded frame exactly; the output is usually LARGER than a typical delivery file. No target size is applied.");
    if (container === "mp4") warnings.push("Lossless H.264 (High 4:4:4 Predictive) does not play in most browsers and phones; it is meant for archiving/editing.");
    return {
      mode: "lossless",
      codec: container === "mp4" ? "h264" : "ffv1",
      codecReason: container === "mp4" ? "H.264 lossless (QP 0) in MP4" : "FFV1 lossless in MKV",
      container,
      strategy: "Mathematically lossless encode, verified by hashing every decoded frame of source and output",
      budget: null,
      feasibility: null,
      feasibilityNote: null,
      audioPlan: audio.label,
      pixFmtPlan: `Pixel format kept as ${srcPix} (no colour conversion)`,
      warnings,
      alternatives: [],
      canRemux: false,
    };
  }

  // ── Lossy modes ──────────────────────────────────────────────────────
  const custom = req.mode === "custom" ? req.custom : undefined;
  const dims = outputDims(v.width, v.height, custom?.resolution ?? null);
  const outFps = custom?.fps && v.fps && custom.fps < v.fps ? custom.fps : v.fps ?? 30;
  if (custom?.fps && v.fps && custom.fps >= v.fps) warnings.push(`Requested ${custom.fps} FPS is not below the source ${v.fps.toFixed(2)} FPS — keeping source FPS (frames are never invented).`);
  if (custom?.resolution && custom.resolution < MIN_OUTPUT_SHORT_SIDE) warnings.push(`Minimum output resolution is ${MIN_OUTPUT_SHORT_SIDE}p — ${custom.resolution}p is not allowed.`);
  else if (custom?.resolution && !dims.scaled) warnings.push("Requested resolution is not below the source — keeping source resolution (no upscaling).");
  const audio = decideAudio(req, info, "mp4");
  const targetMB = req.mode === "custom" ? custom?.targetSizeMB ?? null : req.targetSizeMB;
  const maxVideoBps = custom?.maxBitrateKbps ? custom.maxBitrateKbps * 1000 : null;

  const budget = targetMB
    ? computeBudget({
        targetBytes: targetMB * MB,
        durationSec: info.duration,
        audioBps: audio.bps,
        outWidth: dims.width,
        outHeight: dims.height,
        outFps,
        audioSampleRate: info.audio?.sampleRate ?? null,
        maxVideoBps,
      })
    : null;

  const requestedCodec = custom ? custom.codec : req.codec;
  const rec = budget
    ? recommendCodec(requestedCodec, budget.bitsPerPixel, budget.videoBps, caps)
    : recommendCodec(requestedCodec === "auto" ? "h264" : requestedCodec, 1, 1e9, caps);
  const codec = rec.codec;
  const feasibility = budget ? feasibilityFor(budget.bitsPerPixel, budget.videoBps, codec) : null;

  const is8bit = (v.bitDepth ?? 8) <= 8;
  let pixFmtPlan: string;
  if (codec === "h264") {
    pixFmtPlan = srcPix === "yuv420p" || srcPix === "yuvj420p" ? `Kept as ${srcPix} (no colour conversion)` : `Converted ${srcPix} → yuv420p for H.264 playback compatibility`;
  } else {
    const target = is8bit ? "yuv420p" : "yuv420p10le";
    pixFmtPlan = srcPix === target || srcPix === "yuvj420p" ? `Kept as ${srcPix} (no colour conversion)` : `Converted ${srcPix} → ${target}${is8bit ? "" : " (10-bit preserved)"}`;
  }

  const canRemux =
    req.mode === "smart" &&
    MP4_VIDEO_COPYABLE.has(v.codec) &&
    (!info.audio || (MP4_AUDIO_COPYABLE.has(info.audio.codec) && req.audio.mode !== "remove" && req.audio.mode !== "aac")) &&
    info.size <= req.targetSizeMB * MB &&
    (info.bitrate ?? Infinity) <= MAX_AVG_BITRATE &&
    (srcPix === "yuv420p" || srcPix === "yuvj420p" || srcPix === "yuv420p10le");

  let strategy: string;
  if (req.mode === "smart") {
    strategy = canRemux
      ? "Source already meets the size and bitrate limits — stream copy into MP4 (no re-encode, no quality loss)"
      : `Quality-first: sample-encode at CRF ${CRF_TABLE[codec][req.qualityPreference]} to measure what this content needs; use CRF if it fits under the target, otherwise 2-pass at the full budget`;
  } else if (req.mode === "strict") {
    strategy = `${codec === "av1" ? "Single-pass VBR" : "2-pass"} at the computed bitrate, verify actual size, retry with corrected bitrate (max 4 attempts)`;
  } else {
    strategy = budget
      ? `${codec === "av1" ? "Single-pass VBR" : "2-pass"} to ${targetMB} MB with retries`
      : `Quality-targeted CRF ${CRF_TABLE[codec][req.qualityPreference]}${maxVideoBps ? ` capped at ${formatMbps(maxVideoBps)}` : " capped at 10 Mbps average"}`;
  }

  if (v.isVfr) warnings.push("Source has a variable frame rate — original frame timestamps are preserved.");
  if (codec !== "h264") warnings.push(`${codec === "h265" ? "HEVC" : "AV1"} output may not preview in this browser; the downloaded file is unaffected.`);
  if (budget && budget.videoBps <= 0) warnings.push("Audio and container overhead alone exceed the target size.");
  if (info.audio && audio.action === "aac" && info.audio.bitrate && info.audio.bitrate < audio.bps)
    warnings.push(`Source audio is ${formatMbps(info.audio.bitrate)}; re-encoding at a higher bitrate cannot restore lost detail.`);
  if (info.audioStreamCount > 1) warnings.push(`Source has ${info.audioStreamCount} audio tracks — only the first is kept.`);
  if (info.subtitleStreamCount > 0) warnings.push("Subtitle tracks are not carried into the MP4 output.");

  const alternatives = budget && feasibility && feasibility !== "comfortable" && feasibility !== "good" ? buildAlternatives(info, req, audio.bps, codec, caps) : [];

  return {
    mode: req.mode,
    codec: canRemux ? "copy" : codec,
    codecReason: canRemux ? "Stream copy — the original encoded video is kept untouched" : rec.reason,
    container: "mp4",
    strategy,
    budget,
    feasibility: canRemux ? "comfortable" : feasibility,
    feasibilityNote: canRemux ? "No re-encoding needed." : feasibility ? FEASIBILITY_TEXT[feasibility] : "No size target — quality decides the size (bitrate capped at 10 Mbps average).",
    audioPlan: canRemux && info.audio ? `Copied without re-encoding (${info.audio.codec.toUpperCase()})` : audio.label,
    pixFmtPlan: canRemux ? `Kept as ${srcPix}` : pixFmtPlan,
    warnings,
    alternatives,
    canRemux,
  };
}
