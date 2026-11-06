import "server-only";
import path from "node:path";
import fsp from "node:fs/promises";
import { config } from "../config";
import { runFfmpeg } from "../process";
import { probe } from "../ffprobe";
import { measureQuality, verifyLossless } from "../quality";
import { getCapabilities } from "../capabilities";
import { adoptFile, mediaPath, type FileMeta } from "../storage";
import { JobStop, type JobContext } from "../jobs";
import {
  buildAlternatives,
  buildPlan,
  computeBudget,
  CRF_TABLE,
  decideAudio,
  feasibilityFor,
  formatMbps,
  MAX_AVG_BITRATE,
  MB,
  outputDims,
  QUALITY_THRESHOLDS,
  FEASIBILITY_TEXT,
  sizeLimitBytes,
} from "@/lib/plan";
import type {
  AttemptRecord,
  Capabilities,
  CompressRequest,
  CompressionPlan,
  MediaInfo,
  QualityMetrics,
  VideoCodecChoice,
} from "@/lib/types";

const MAX_ATTEMPTS = 4;

interface EncodeSpec {
  codec: VideoCodecChoice;
  preset: string;
  /** quality-targeted mode */
  crf?: number;
  /** average bitrate (bits/s) for ABR / 2-pass */
  bitrate?: number;
  maxrate?: number;
  twoPass: boolean;
  width: number;
  height: number;
  scale: boolean;
  fps: number | null; // null = preserve
}

function presetFor(codec: VideoCodecChoice, info: MediaInfo, w: number, h: number, fps: number, slower = false): string {
  const work = w * h * fps * Math.max(info.duration, 1);
  const ref = 1920 * 1080 * 30 * 60; // one minute of 1080p30
  if (codec === "h264") return slower ? (work <= ref ? "slower" : "slow") : work <= ref ? "slow" : work <= ref * 4 ? "medium" : "fast";
  if (codec === "h265") return slower ? (work <= ref ? "slow" : "medium") : work <= ref * 0.5 ? "medium" : "fast";
  // SVT-AV1 presets: lower = slower/better
  return slower ? (work <= ref ? "5" : "7") : work <= ref ? "6" : "8";
}

function pixFmtFor(codec: VideoCodecChoice, info: MediaInfo, av1Encoder: string | null) {
  const src = info.video?.pixFmt ?? "yuv420p";
  const high = (info.video?.bitDepth ?? 8) > 8;
  if (codec === "h264") return src === "yuvj420p" ? "yuvj420p" : "yuv420p";
  if (codec === "av1" && av1Encoder === "libsvtav1") return high ? "yuv420p10le" : "yuv420p";
  if (high) return "yuv420p10le";
  return src === "yuvj420p" ? "yuvj420p" : "yuv420p";
}

function threadArgs() {
  return config.ffmpegThreads ? ["-threads", String(config.ffmpegThreads)] : [];
}

function filterArgs(spec: Pick<EncodeSpec, "scale" | "width" | "height" | "fps">) {
  const vf: string[] = [];
  if (spec.fps) vf.push(`fps=${spec.fps}`);
  if (spec.scale) vf.push(`scale=${spec.width}:${spec.height}:flags=lanczos`, "setsar=1");
  return vf.length ? ["-vf", vf.join(",")] : [];
}

function videoCodecArgs(spec: EncodeSpec, caps: Capabilities, info: MediaInfo, pass: 0 | 1 | 2, passlog: string): string[] {
  const pix = pixFmtFor(spec.codec, info, caps.encoders.av1Encoder);
  const rate: string[] = [];
  if (spec.crf !== undefined) rate.push("-crf", String(spec.crf));
  if (spec.bitrate !== undefined) rate.push("-b:v", String(Math.round(spec.bitrate)));
  if (spec.maxrate) rate.push("-maxrate", String(Math.round(spec.maxrate)), "-bufsize", String(Math.round(spec.maxrate)));

  if (spec.codec === "h264") {
    const p = pass ? ["-pass", String(pass), "-passlogfile", passlog] : [];
    return ["-c:v", "libx264", "-preset", spec.preset, "-profile:v", pix === "yuv420p" || pix === "yuvj420p" ? "high" : "high10", "-pix_fmt", pix, ...rate, ...p];
  }
  if (spec.codec === "h265") {
    const params = ["log-level=error"];
    if (pass) params.push(`pass=${pass}`, `stats=${passlog}.x265.log`);
    return ["-c:v", "libx265", "-preset", spec.preset, "-pix_fmt", pix, ...rate, "-x265-params", params.join(":"), "-tag:v", "hvc1"];
  }
  // AV1
  if (caps.encoders.av1Encoder === "libsvtav1") {
    return ["-c:v", "libsvtav1", "-preset", spec.preset, "-pix_fmt", pix, ...rate, "-svtav1-params", "tune=0"];
  }
  return ["-c:v", "libaom-av1", "-cpu-used", "6", "-row-mt", "1", "-pix_fmt", pix, ...rate];
}

function audioArgs(decision: ReturnType<typeof decideAudio>, info: MediaInfo): string[] {
  if (decision.action === "none" || !info.audio) return ["-an"];
  if (decision.action === "copy") return ["-c:a", "copy"];
  if (decision.action === "alac") return ["-c:a", "alac"];
  return ["-c:a", "aac", "-b:a", String(Math.round(decision.bps))];
}

function mapArgs(info: MediaInfo, withAudio: boolean) {
  const m = ["-map", `0:${info.video!.index}`];
  if (withAudio && info.audio) m.push("-map", `0:${info.audio.index}`);
  return m;
}

function eta(fraction: number | null, speed: number | null, duration: number) {
  if (fraction === null || !speed || speed <= 0) return null;
  return Math.max(0, Math.round(((1 - fraction) * duration) / speed));
}

class Engine {
  attempts: AttemptRecord[] = [];
  caps!: Capabilities;
  constructor(private ctx: JobContext, private req: CompressRequest, private src: FileMeta, private info: MediaInfo) {}

  get srcPath() {
    return mediaPath(this.src);
  }

  async encode(spec: EncodeSpec, audio: ReturnType<typeof decideAudio>, outPath: string, label: string) {
    const { ctx, info } = this;
    const passlog = path.join(ctx.workDir, "passlog");
    const fpsMode = spec.fps ? [] : ["-fps_mode", "vfr"];
    const common = ["-i", this.srcPath, ...threadArgs()];
    const report = (phase: string, phaseLabel: string) => (p: { fraction: number | null; speed: number | null }) =>
      ctx.progress({ phase, phaseLabel, percent: p.fraction === null ? null : Math.round(p.fraction * 1000) / 10, speed: p.speed ? `${p.speed.toFixed(2)}×` : null, etaSec: eta(p.fraction, p.speed, info.duration) });

    if (spec.twoPass && spec.codec !== "av1") {
      await runFfmpeg(
        [...common, ...mapArgs(info, false), ...filterArgs(spec), ...fpsMode, ...videoCodecArgs(spec, this.caps, info, 1, passlog), "-an", "-f", "null", "-"],
        { signal: ctx.signal, durationSec: info.duration, onProgress: report("encode", `${label} · pass 1 of 2 (analysis)`) },
      );
      await runFfmpeg(
        [...common, ...mapArgs(info, audio.action !== "none"), ...filterArgs(spec), ...fpsMode, ...videoCodecArgs(spec, this.caps, info, 2, passlog), ...audioArgs(audio, info), "-movflags", "+faststart", "-map_chapters", "-1", outPath],
        { signal: ctx.signal, durationSec: info.duration, onProgress: report("encode", `${label} · pass 2 of 2 (encode)`) },
      );
    } else {
      await runFfmpeg(
        [...common, ...mapArgs(info, audio.action !== "none"), ...filterArgs(spec), ...fpsMode, ...videoCodecArgs(spec, this.caps, info, 0, passlog), ...audioArgs(audio, info), "-movflags", "+faststart", "-map_chapters", "-1", outPath],
        { signal: ctx.signal, durationSec: info.duration, onProgress: report("encode", label) },
      );
    }
    return this.verify(outPath, audio.action !== "none");
  }

  /** Probe the produced file and make sure it is a real, complete, playable-looking video. */
  async verify(outPath: string, expectAudio: boolean) {
    this.ctx.progress({ phase: "verify", phaseLabel: "Verifying output file", percent: null, speed: null, etaSec: null });
    const stat = await fsp.stat(outPath);
    const out = await probe(outPath, this.ctx.signal);
    if (!out.video) throw new Error("Verification failed: output has no video stream");
    if (expectAudio && !out.audio) throw new Error("Verification failed: audio track missing from output");
    const tol = Math.max(0.5, this.info.duration * 0.02);
    if (Math.abs(out.duration - this.info.duration) > tol) {
      throw new Error(`Verification failed: output duration ${out.duration.toFixed(2)}s differs from source ${this.info.duration.toFixed(2)}s`);
    }
    return { size: stat.size, out, bitrate: Math.round((stat.size * 8) / out.duration) };
  }

  async quality(outPath: string, out: MediaInfo): Promise<QualityMetrics | null> {
    if (!this.req.qualityGuard) return null;
    this.ctx.progress({ phase: "quality", phaseLabel: "Quality Guard · measuring SSIM & PSNR against the source", percent: 0, speed: null, etaSec: null });
    return measureQuality(this.srcPath, this.info, outPath, out, {
      signal: this.ctx.signal,
      vmaf: this.req.vmaf,
      onProgress: (f) => this.ctx.progress({ percent: f === null ? null : Math.round(f * 1000) / 10 }),
    });
  }

  /** Encode short segments at the target CRF to learn the bitrate this content actually needs. */
  async sampleCrfBitrate(spec: EncodeSpec): Promise<number> {
    const { info, ctx } = this;
    const segLen = 2;
    const count = info.duration >= 30 ? 4 : 3;
    let bytes = 0;
    let secs = 0;
    for (let i = 0; i < count; i++) {
      const start = Math.max(0, ((i + 0.5) * info.duration) / count - segLen / 2);
      const out = path.join(ctx.workDir, `sample${i}.mp4`);
      await runFfmpeg(
        ["-ss", start.toFixed(3), "-t", String(segLen), "-i", this.srcPath, ...threadArgs(), ...mapArgs(info, false), ...filterArgs(spec), ...videoCodecArgs({ ...spec, twoPass: false }, this.caps, info, 0, ""), "-an", out],
        {
          signal: ctx.signal,
          durationSec: segLen,
          onProgress: (p) => ctx.progress({ phase: "sample", phaseLabel: `Measuring content complexity · sample ${i + 1} of ${count}`, percent: Math.round(((i + (p.fraction ?? 0)) / count) * 1000) / 10 }),
        },
      );
      const st = await fsp.stat(out);
      const pr = await probe(out, ctx.signal);
      bytes += st.size;
      secs += pr.duration || segLen;
      await fsp.rm(out, { force: true });
    }
    return (bytes * 8) / secs;
  }

  record(a: Omit<AttemptRecord, "attempt">) {
    const rec = { attempt: this.attempts.length + 1, ...a };
    this.attempts.push(rec);
    return rec;
  }
}

function describeMetrics(m: QualityMetrics | null) {
  if (!m) return "quality not measured";
  const parts = [];
  if (m.ssim !== null) parts.push(`SSIM ${m.ssim.toFixed(4)}`);
  if (m.psnr !== null) parts.push(m.psnr >= 999 ? "PSNR ∞ (identical)" : `PSNR ${m.psnr.toFixed(2)} dB`);
  if (m.vmaf !== null) parts.push(`VMAF ${m.vmaf.toFixed(1)}`);
  return parts.join(", ");
}

function outName(src: FileMeta, suffix: string, ext: string) {
  const base = src.name.replace(/\.[^.]+$/, "").slice(0, 80) || "video";
  return `${base}_mamatkilat_${suffix}.${ext}`;
}

export async function runCompression(ctx: JobContext, req: CompressRequest, src: FileMeta) {
  ctx.progress({ phase: "analyze", phaseLabel: "Analysing source with FFprobe", percent: null });
  const info = await probe(mediaPath(src), ctx.signal);
  if (!info.video) throw new JobStop("The file has no video stream.", "failed");
  if (!info.duration || info.duration <= 0) throw new JobStop("Could not determine the video duration, so a bitrate budget cannot be computed.", "failed");
  const caps = await getCapabilities();
  const plan = buildPlan(req, info, caps);
  const eng = new Engine(ctx, req, src, info);
  eng.caps = caps;
  ctx.log("info", `Source: ${info.video.width}×${info.video.height}, ${info.video.fps?.toFixed(3) ?? "?"} FPS, ${info.video.codec.toUpperCase()}, ${info.duration.toFixed(2)} s, ${formatMbps(info.bitrate ?? 0)}`);
  ctx.log("info", `Plan: ${plan.strategy}`);
  if (plan.codec !== "copy") ctx.log("info", plan.codecReason);
  for (const w of plan.warnings) ctx.log("warn", w);

  if (req.mode === "lossless") return runLossless(ctx, eng, req, src, info, plan);

  const threshold = QUALITY_THRESHOLDS[req.qualityPreference];
  const audio = decideAudio(req, info, "mp4");
  ctx.log("info", `Audio: ${audio.label}`);

  // ── Smart: stream copy when the source already complies ─────────────
  if (plan.canRemux) {
    const outPath = path.join(ctx.workDir, "remux.mp4");
    ctx.progress({ phase: "encode", phaseLabel: "Remuxing to MP4 (stream copy)", percent: 0 });
    await runFfmpeg(["-i", eng.srcPath, ...mapArgs(info, !!info.audio), "-c", "copy", "-movflags", "+faststart", "-map_chapters", "-1", outPath], {
      signal: ctx.signal,
      durationSec: info.duration,
      onProgress: (p) => ctx.progress({ percent: p.fraction === null ? null : Math.round(p.fraction * 100) }),
    });
    const v = await eng.verify(outPath, !!info.audio);
    const metrics: QualityMetrics = { ssim: null, ssimY: null, ssimDb: null, psnr: null, psnrMin: null, vmaf: null, coverage: "not required", note: "Stream copy: the encoded video data is identical to the source, so no quality was lost.", bitExact: true };
    eng.record({ codec: "copy", strategy: "stream copy", videoKbps: null, crf: null, sizeBytes: v.size, bitrate: v.bitrate, metrics, verdict: "Already within target — no re-encode needed" });
    return finish(ctx, eng, src, info, plan, outPath, v, metrics, req.targetSizeMB * MB, true, "copy", "mp4");
  }

  const budget = plan.budget;
  const custom = req.mode === "custom" ? req.custom : undefined;
  const dims = outputDims(info.video.width, info.video.height, custom?.resolution ?? null);
  const outFps = budget?.outFps ?? info.video.fps ?? 30;
  const fpsArg = custom?.fps && info.video.fps && custom.fps < info.video.fps ? custom.fps : null;
  const maxCap = Math.min(MAX_AVG_BITRATE - audio.bps, custom?.maxBitrateKbps ? custom.maxBitrateKbps * 1000 : Infinity);
  let codec = plan.codec as VideoCodecChoice;
  const baseSpec = (c: VideoCodecChoice, slower = false): Omit<EncodeSpec, "twoPass"> => ({
    codec: c,
    preset: presetFor(c, info, dims.width, dims.height, outFps, slower),
    width: dims.width,
    height: dims.height,
    scale: dims.scaled,
    fps: fpsArg,
  });

  // ── Custom without a size target: quality-targeted single encode ────
  if (!budget) {
    const crf = CRF_TABLE[codec][req.qualityPreference];
    const outPath = path.join(ctx.workDir, "crf.mp4");
    let v = await eng.encode({ ...baseSpec(codec), crf, maxrate: maxCap, twoPass: false }, audio, outPath, `Encoding ${codec.toUpperCase()} at CRF ${crf}`);
    if (v.bitrate >= MAX_AVG_BITRATE * 0.995) {
      // VBV can let short clips average above the cap; fall back to a size-exact 2-pass at the cap.
      const capped = Math.floor(MAX_AVG_BITRATE * 0.96 - audio.bps);
      eng.record({ codec, strategy: `CRF ${crf}`, videoKbps: null, crf, sizeBytes: v.size, bitrate: v.bitrate, metrics: null, verdict: `Average ${formatMbps(v.bitrate)} is not below 10 Mbps → 2-pass at ${formatMbps(capped)}` });
      ctx.log("warn", `CRF output averaged ${formatMbps(v.bitrate)}; re-encoding with 2-pass at ${formatMbps(capped)} to respect the 10 Mbps limit`);
      v = await eng.encode({ ...baseSpec(codec), bitrate: capped, twoPass: true }, audio, outPath, `Encoding ${codec.toUpperCase()} 2-pass @ ${formatMbps(capped)}`);
    }
    const metrics = await eng.quality(outPath, v.out);
    const passed = !metrics || metrics.ssim === null || metrics.ssim >= threshold.ssim;
    eng.record({ codec, strategy: `CRF ${crf}`, videoKbps: null, crf, sizeBytes: v.size, bitrate: v.bitrate, metrics, verdict: passed ? "Accepted" : `Below Quality Guard threshold (${threshold.label})` });
    if (!passed) return reject(ctx, eng, src, info, req, plan, outPath, v, metrics, `The encode scored ${describeMetrics(metrics)}, below the ${threshold.label} threshold. Choose a lower CRF quality preference or a higher maximum bitrate.`);
    return finish(ctx, eng, src, info, plan, outPath, v, metrics, null, passed, codec, "mp4");
  }

  const targetBytes = budget.targetBytes;
  // Enforced limit = user target, tightened so the average bitrate stays below 10 Mbps.
  const limitBytes = sizeLimitBytes(targetBytes, info.duration);
  if (limitBytes < targetBytes) ctx.log("info", `10 Mbps average-bitrate rule: this ${info.duration.toFixed(2)} s clip may be at most ${(limitBytes / MB).toFixed(2)} MB`);
  ctx.log("info", `Budget: ${formatMbps(budget.totalBps)} total → ${formatMbps(budget.videoBps)} video + ${formatMbps(budget.audioBps)} audio + ${formatMbps(budget.overheadBps)} container + ${formatMbps(budget.safetyBps)} safety (${budget.bitsPerPixel.toFixed(3)} bits/pixel)`);

  if (plan.feasibility === "unrealistic") {
    ctx.job.alternatives = plan.alternatives.length ? plan.alternatives : buildAlternatives(info, req, audio.bps, codec, caps);
    throw new JobStop(
      `Reaching ${(targetBytes / MB).toFixed(2)} MB for this ${info.duration.toFixed(1)} s video at ${dims.width}×${dims.height} and ${outFps.toFixed(2)} FPS leaves only ${formatMbps(Math.max(0, budget.videoBps))} for video (${budget.bitsPerPixel.toFixed(4)} bits per pixel). ${FEASIBILITY_TEXT.unrealistic} Nothing was encoded — resolution and FPS are never reduced without your permission. Pick one of the alternatives below.`,
    );
  }

  // ── Smart: try quality-targeted CRF first if it fits ─────────────────
  if (req.mode === "smart") {
    const crf = CRF_TABLE[codec][req.qualityPreference];
    const short = info.duration <= 15;
    let fits = short;
    if (!short) {
      const est = await eng.sampleCrfBitrate({ ...baseSpec(codec), crf, maxrate: maxCap, twoPass: false });
      const projected = ((Math.min(est, maxCap) * 1.15 + audio.bps + budget.overheadBps) * info.duration) / 8;
      fits = projected <= limitBytes;
      ctx.log("info", `Complexity sample: CRF ${crf} needs ≈${formatMbps(est)} → projected ${(projected / MB).toFixed(2)} MB (incl. 15% margin) — ${fits ? "fits; using quality-targeted CRF" : "exceeds target; using 2-pass at the full budget"}`);
    }
    if (fits) {
      const outPath = path.join(ctx.workDir, "smart-crf.mp4");
      const v = await eng.encode({ ...baseSpec(codec), crf, maxrate: Math.min(maxCap, budget.videoBps * 2.5), twoPass: false }, audio, outPath, `Encoding ${codec.toUpperCase()} at CRF ${crf}`);
      if (v.size <= limitBytes) {
        const metrics = await eng.quality(outPath, v.out);
        const passed = !metrics || metrics.ssim === null || metrics.ssim >= threshold.ssim;
        eng.record({ codec, strategy: `CRF ${crf} (quality-targeted)`, videoKbps: null, crf, sizeBytes: v.size, bitrate: v.bitrate, metrics, verdict: passed ? "Under target and passed Quality Guard" : "Under target but below Quality Guard — spending the full budget instead" });
        ctx.log(passed ? "success" : "warn", `CRF result: ${(v.size / MB).toFixed(2)} MB, ${describeMetrics(metrics)}`);
        if (passed) return finish(ctx, eng, src, info, plan, outPath, v, metrics, targetBytes, true, codec, "mp4");
      } else {
        eng.record({ codec, strategy: `CRF ${crf} (quality-targeted)`, videoKbps: null, crf, sizeBytes: v.size, bitrate: v.bitrate, metrics: null, verdict: `Over target (${(v.size / MB).toFixed(2)} MB) — switching to 2-pass at the budget` });
        ctx.log("warn", `CRF result ${(v.size / MB).toFixed(2)} MB exceeds the target — switching to size-targeted 2-pass`);
      }
      await fsp.rm(outPath, { force: true });
    }
  }

  // ── Size-targeted retry engine (Strict, Custom with target, Smart fallback) ──
  let videoBps = budget.videoBps;
  let slower = false;
  const triedCodecs = new Set<VideoCodecChoice>([codec]);
  const autoCodec = (custom ? custom.codec : req.codec) === "auto";
  type Candidate = { path: string; v: Awaited<ReturnType<Engine["verify"]>>; metrics: QualityMetrics | null; codec: VideoCodecChoice };
  let best: Candidate | null = null as Candidate | null;
  let bestRejected: Candidate | null = null as Candidate | null;
  const max = MAX_ATTEMPTS;
  let stopReason: string | null = null;

  for (let i = 1; i <= max; i++) {
    ctx.progress({ attempt: i, maxAttempts: max });
    const outPath = path.join(ctx.workDir, `attempt${i}.mp4`);
    const spec: EncodeSpec = { ...baseSpec(codec, slower), bitrate: videoBps, twoPass: true };
    ctx.log("info", `Attempt ${i}/${max}: ${codec.toUpperCase()} ${spec.preset} preset, ${spec.twoPass && codec !== "av1" ? "2-pass" : "1-pass VBR"} at ${formatMbps(videoBps)}`);
    const v = await eng.encode(spec, audio, outPath, `Attempt ${i}/${max} · ${codec.toUpperCase()} @ ${formatMbps(videoBps)}`);
    const sizeMB = (v.size / MB).toFixed(3);

    if (v.size > limitBytes) {
      const goal = limitBytes * 0.985;
      const corrected = Math.min(videoBps - ((v.size - goal) * 8) / info.duration, videoBps * (goal / v.size));
      eng.record({ codec, strategy: `2-pass @ ${formatMbps(videoBps)}`, videoKbps: Math.round(videoBps / 1000), crf: null, sizeBytes: v.size, bitrate: v.bitrate, metrics: null, verdict: `Over limit by ${(((v.size - limitBytes) / limitBytes) * 100).toFixed(1)}% → retry at ${formatMbps(corrected)}` });
      ctx.log("warn", `Output ${sizeMB} MB exceeds the ${(limitBytes / MB).toFixed(2)} MB limit — correcting bitrate using the measured overshoot`);
      await fsp.rm(outPath, { force: true });
      videoBps = Math.floor(corrected);
      if (feasibilityFor(videoBps / (dims.width * dims.height * outFps), videoBps, codec) === "unrealistic") {
        stopReason = `After correcting for the encoder's overshoot, only ${formatMbps(videoBps)} remains for video — too little to keep watchable quality at ${dims.width}×${dims.height}.`;
        break;
      }
      continue;
    }

    const metrics = await eng.quality(outPath, v.out);
    const passed = !metrics || metrics.ssim === null || metrics.ssim >= threshold.ssim;
    ctx.log(passed ? "success" : "warn", `Attempt ${i}: ${sizeMB} MB (${formatMbps(v.bitrate)}), ${describeMetrics(metrics)} — ${passed ? "passes" : "fails"} ${threshold.label}`);
    const rec = eng.record({ codec, strategy: `2-pass @ ${formatMbps(videoBps)}${slower ? " (slower preset)" : ""}`, videoKbps: Math.round(videoBps / 1000), crf: null, sizeBytes: v.size, bitrate: v.bitrate, metrics, verdict: passed ? "Under target · passed Quality Guard" : "Under target · below Quality Guard threshold" });

    const candidate: Candidate = { path: outPath, v, metrics, codec };
    const better = (a: Candidate | null, b: Candidate) => !a || (b.metrics?.ssim ?? 0) > (a.metrics?.ssim ?? 0);
    if (passed) {
      if (better(best, candidate)) {
        if (best) await fsp.rm(best.path, { force: true });
        best = candidate;
      } else await fsp.rm(outPath, { force: true });
      // Use the remaining budget when the encoder undershot noticeably.
      if (v.size < limitBytes * 0.88 && i < max) {
        const raised = Math.floor(Math.min(maxCap, videoBps * ((limitBytes * 0.975) / v.size)));
        if (raised > videoBps * 1.05) {
          rec.verdict += ` · undershot by ${(100 - (v.size / limitBytes) * 100).toFixed(0)}%, retrying at ${formatMbps(raised)} to use the budget`;
          videoBps = raised;
          continue;
        }
      }
      break;
    }

    // Quality failed while under target. Do NOT blindly lower bitrate — change encoder parameters instead.
    if (better(bestRejected, candidate)) {
      if (bestRejected) await fsp.rm(bestRejected.path, { force: true });
      bestRejected = candidate;
    } else await fsp.rm(outPath, { force: true });
    if (best) break; // we already have a valid result; keep it
    if (autoCodec && codec === "h264" && caps.encoders.h265 && !triedCodecs.has("h265") && i < max) {
      codec = "h265";
      triedCodecs.add("h265");
      videoBps = computeBudget({ targetBytes, durationSec: info.duration, audioBps: audio.bps, outWidth: dims.width, outHeight: dims.height, outFps, audioSampleRate: info.audio?.sampleRate ?? null, maxVideoBps: maxCap }).videoBps;
      rec.verdict += " → retrying with the more efficient H.265 encoder";
      ctx.log("info", "Switching to H.265 (better compression efficiency) instead of reducing bitrate");
      continue;
    }
    if (!slower && i < max) {
      slower = true;
      if (v.size < limitBytes * 0.95) videoBps = Math.floor(Math.min(maxCap, videoBps * ((limitBytes * 0.975) / v.size)));
      rec.verdict += " → retrying with a slower, more efficient encoder preset";
      ctx.log("info", "Retrying with a slower encoder preset (better quality per bit)");
      continue;
    }
    stopReason = `The best attempt scored ${describeMetrics(bestRejected?.metrics ?? null)}, which is below the ${threshold.label} threshold. Lowering the bitrate further would only make it worse.`;
    break;
  }

  if (best) {
    if (bestRejected) await fsp.rm(bestRejected.path, { force: true });
    return finish(ctx, eng, src, info, { ...plan, codec: best.codec }, best.path, best.v, best.metrics, targetBytes, true, best.codec, "mp4");
  }
  if (!stopReason) stopReason = `Could not get the file under ${(limitBytes / MB).toFixed(2)} MB within ${max} attempts.`;
  ctx.job.alternatives = buildAlternatives(info, req, audio.bps, codec, caps);
  if (bestRejected) return reject(ctx, eng, src, info, req, plan, bestRejected.path, bestRejected.v, bestRejected.metrics, `${stopReason} The Quality Guard stopped the process instead of returning an over-compressed video. Resolution and FPS were not reduced without your permission.`);
  throw new JobStop(`${stopReason} Resolution and FPS were not reduced without your permission — try one of the alternatives below.`);
}

async function runLossless(ctx: JobContext, eng: Engine, req: CompressRequest, src: FileMeta, info: MediaInfo, plan: CompressionPlan) {
  const container = plan.container;
  const audio = decideAudio(req, info, container);
  const pix = info.video!.pixFmt ?? "yuv420p";
  const outPath = path.join(ctx.workDir, `lossless.${container}`);
  const vargs =
    container === "mp4"
      ? ["-c:v", "libx264", "-qp", "0", "-preset", "medium", "-pix_fmt", pix]
      : ["-c:v", "ffv1", "-level", "3", "-g", "1", "-slices", "4", "-slicecrc", "1", "-pix_fmt", pix];
  await runFfmpeg(
    ["-i", eng.srcPath, ...threadArgs(), ...mapArgs(info, audio.action !== "none"), "-fps_mode", "passthrough", ...vargs, ...audioArgs(audio, info), ...(container === "mp4" ? ["-movflags", "+faststart"] : []), "-map_chapters", "-1", outPath],
    {
      signal: ctx.signal,
      durationSec: info.duration,
      onProgress: (p) => ctx.progress({ phase: "encode", phaseLabel: `Lossless encode (${container === "mp4" ? "H.264 QP 0" : "FFV1"})`, percent: p.fraction === null ? null : Math.round(p.fraction * 1000) / 10, speed: p.speed ? `${p.speed.toFixed(2)}×` : null, etaSec: eta(p.fraction, p.speed, info.duration) }),
    },
  );
  const v = await eng.verify(outPath, audio.action !== "none");
  ctx.progress({ phase: "quality", phaseLabel: "Verifying losslessness · hashing every decoded frame", percent: null });
  const check = await verifyLossless(eng.srcPath, outPath, pix, ctx.workDir, ctx.signal);
  const metrics: QualityMetrics = {
    ssim: check.match ? 1 : null, ssimY: check.match ? 1 : null, ssimDb: check.match ? Infinity : null, psnr: check.match ? 999 : null, psnrMin: null, vmaf: null,
    coverage: "every frame (MD5 of decoded pixels)",
    note: check.match ? "Decoded frames are bit-identical to the source." : "Frame hashes differ from the source.",
    bitExact: check.match,
  };
  eng.record({ codec: plan.codec, strategy: plan.codecReason, videoKbps: null, crf: null, sizeBytes: v.size, bitrate: v.bitrate, metrics, verdict: check.match ? "Bit-exact frames verified" : "Hash mismatch" });
  if (!check.match) throw new JobStop("Lossless verification failed: decoded output frames do not match the source. The file was not offered for download.", "failed");
  ctx.log("success", `Lossless verified: all decoded frames match (${check.source.slice(0, 20)}…)`);
  if (v.size > info.size) ctx.log("info", `Lossless output is ${((v.size / info.size) * 100).toFixed(0)}% of the source size — lossless files are usually larger than lossy sources.`);
  return finish(ctx, eng, src, info, plan, outPath, v, metrics, null, true, plan.codec === "ffv1" ? "ffv1-lossless" : "h264-lossless", container);
}

async function finish(
  ctx: JobContext, eng: Engine, src: FileMeta, info: MediaInfo, plan: CompressionPlan, outPath: string,
  v: { size: number; out: MediaInfo; bitrate: number }, metrics: QualityMetrics | null, targetBytes: number | null, qualityPassed: boolean, suffix: string, ext: "mp4" | "mkv",
) {
  const req = ctx.job.request!;
  if (targetBytes !== null && v.size > sizeLimitBytes(targetBytes, info.duration)) throw new Error("Internal check failed: output exceeds the size/bitrate limit");
  if (req.mode !== "lossless" && v.bitrate >= MAX_AVG_BITRATE) throw new Error("Internal check failed: average bitrate is not below 10 Mbps");
  const stored = await adoptFile(outPath, { owner: src.owner, name: outName(src, suffix, ext), ext, kind: "output", info: v.out, sourceId: src.id });
  ctx.job.compress = {
    outputFileId: stored.id,
    sourceFileId: src.id,
    sourceInfo: info,
    outputInfo: v.out,
    plan,
    metrics,
    attempts: eng.attempts,
    targetBytes,
    meetsTarget: targetBytes === null ? null : v.size <= targetBytes,
    qualityPassed: req.mode === "lossless" ? true : metrics ? qualityPassed : null,
    threshold: req.mode === "lossless" ? null : QUALITY_THRESHOLDS[req.qualityPreference],
  };
  ctx.log("success", `Done: ${(v.size / MB).toFixed(3)} MB at ${formatMbps(v.bitrate)} — ${(100 - (v.size / info.size) * 100).toFixed(1)}% smaller than the source`);
}

async function reject(
  ctx: JobContext, eng: Engine, src: FileMeta, info: MediaInfo, req: CompressRequest, plan: CompressionPlan, outPath: string,
  v: { size: number; out: MediaInfo; bitrate: number }, metrics: QualityMetrics | null, explanation: string,
) {
  const stored = await adoptFile(outPath, { owner: src.owner, name: outName(src, "below-quality-threshold", "mp4"), ext: "mp4", kind: "output", info: v.out, sourceId: src.id });
  ctx.job.rejectedOutput = { fileId: stored.id, size: v.size, metrics };
  ctx.job.compress = {
    outputFileId: stored.id, sourceFileId: src.id, sourceInfo: info, outputInfo: v.out, plan, metrics, attempts: eng.attempts,
    targetBytes: plan.budget?.targetBytes ?? null, meetsTarget: plan.budget ? v.size <= plan.budget.targetBytes : null, qualityPassed: false, threshold: QUALITY_THRESHOLDS[req.qualityPreference],
  };
  if (!ctx.job.alternatives.length) ctx.job.alternatives = buildAlternatives(info, req, decideAudio(req, info, "mp4").bps, (plan.codec === "copy" || plan.codec === "ffv1" ? "h264" : plan.codec), eng.caps);
  throw new JobStop(explanation);
}
