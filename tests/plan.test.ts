import { describe, expect, it } from "vitest";
import { buildPlan, computeBudget, decideAudio, feasibilityFor, MB, outputDims, sizeLimitBytes, MAX_AVG_BITRATE } from "@/lib/plan";
import type { CompressRequest, MediaInfo } from "@/lib/types";

const info = (over: Partial<MediaInfo> = {}, v: Partial<NonNullable<MediaInfo["video"]>> = {}): MediaInfo => ({
  formatName: "mov,mp4", formatLong: null, duration: 60, size: 130 * MB, bitrate: 17_000_000, audioStreamCount: 1, subtitleStreamCount: 0,
  video: { index: 0, codec: "h264", codecLong: null, profile: "High", codedWidth: 1920, codedHeight: 1080, width: 1920, height: 1080, rotation: 0, fps: 30, avgFps: 30, isVfr: false, bitrate: 16_800_000, pixFmt: "yuv420p", bitDepth: 8, sampleAspectRatio: "1:1", displayAspectRatio: "16:9", frameCount: 1800, colorSpace: null, colorPrimaries: null, colorTransfer: null, colorRange: null, ...v },
  audio: { index: 1, codec: "aac", codecLong: null, profile: "LC", sampleRate: 48000, channels: 2, channelLayout: "stereo", bitrate: 128_000, bitrateEstimated: false },
  ...over,
});
const req = (r: Partial<CompressRequest> = {}): CompressRequest => ({ fileId: "a".repeat(32), mode: "strict", qualityPreference: "balanced", targetSizeMB: 9.5, codec: "auto", audio: { mode: "auto", bitrateKbps: 128 }, qualityGuard: true, vmaf: false, ...r });

describe("computeBudget", () => {
  it("follows (bytes × 8) / duration and subtracts audio, overhead and safety", () => {
    const b = computeBudget({ targetBytes: 9.5 * MB, durationSec: 60, audioBps: 128_000, outWidth: 1920, outHeight: 1080, outFps: 30, audioSampleRate: 48000 });
    expect(b.totalBps).toBe(Math.round((9.5 * MB * 8) / 60));
    expect(Math.abs(b.videoBps - (b.totalBps - 128_000 - b.overheadBps - b.safetyBps))).toBeLessThanOrEqual(1);
    expect(b.overheadBps).toBeGreaterThan(0);
    expect(b.videoBps + b.audioBps + b.overheadBps + b.safetyBps).toBeLessThanOrEqual(b.totalBps);
  });
  it("never lets the average exceed 10 Mbps, even for short clips", () => {
    const b = computeBudget({ targetBytes: 9.5 * MB, durationSec: 3, audioBps: 128_000, outWidth: 1920, outHeight: 1080, outFps: 30, audioSampleRate: 48000 });
    expect(b.totalBps).toBeLessThan(MAX_AVG_BITRATE);
    expect(sizeLimitBytes(9.5 * MB, 3)).toBeLessThan((MAX_AVG_BITRATE * 3) / 8);
    expect(sizeLimitBytes(9.5 * MB, 60)).toBe(9.5 * MB);
  });
});

describe("feasibility", () => {
  it("grades bits-per-pixel and accounts for codec efficiency", () => {
    expect(feasibilityFor(0.12, 5e6, "h264")).toBe("comfortable");
    expect(feasibilityFor(0.04, 5e6, "h264")).toBe("tight");
    expect(feasibilityFor(0.04, 5e6, "h265")).toBe("good");
    expect(feasibilityFor(0.005, 5e6, "h264")).toBe("unrealistic");
    expect(feasibilityFor(1, 30_000, "h264")).toBe("unrealistic");
  });
});

describe("outputDims", () => {
  it("never upscales and keeps aspect ratio with even sizes", () => {
    expect(outputDims(1920, 1080, 720)).toEqual({ width: 1280, height: 720, scaled: true });
    expect(outputDims(1080, 1920, 720)).toEqual({ width: 720, height: 1280, scaled: true });
    expect(outputDims(1280, 720, 1080)).toEqual({ width: 1280, height: 720, scaled: false });
    const d = outputDims(1918, 1080, 541);
    expect(d.width % 2).toBe(0);
    expect(d.height % 2).toBe(0);
  });
});

describe("audio decisions", () => {
  it("copies AAC that already fits; never removes audio unless asked", () => {
    expect(decideAudio(req(), info(), "mp4").action).toBe("copy");
    expect(decideAudio(req({ audio: { mode: "auto", bitrateKbps: 96 } }), info(), "mp4").action).toBe("aac");
    expect(decideAudio(req({ audio: { mode: "remove", bitrateKbps: 128 } }), info(), "mp4").action).toBe("none");
    const opus = info({ audio: { ...info().audio!, codec: "opus" } });
    expect(decideAudio(req(), opus, "mp4").action).toBe("aac");
  });
});

describe("buildPlan", () => {
  it("keeps source resolution and fps in non-custom modes", () => {
    const p = buildPlan(req(), info(), null);
    expect(p.budget?.outWidth).toBe(1920);
    expect(p.budget?.outFps).toBe(30);
  });
  it("flags unrealistic targets and offers alternatives", () => {
    const p = buildPlan(req({ targetSizeMB: 1 }), info({}, { width: 3840, height: 2160, codedWidth: 3840, codedHeight: 2160 }), null);
    expect(p.feasibility).toBe("unrealistic");
    expect(p.alternatives.length).toBeGreaterThan(0);
  });
  it("recommends remux when the source already complies", () => {
    const p = buildPlan(req({ mode: "smart" }), info({ size: 2 * MB, bitrate: 2_500_000, duration: 6 }), null);
    expect(p.canRemux).toBe(true);
    expect(p.codec).toBe("copy");
  });
  it("lossless picks FFV1/MKV when x264 cannot keep the pixel format", () => {
    const p = buildPlan(req({ mode: "lossless" }), info({}, { pixFmt: "gbrp" }), null);
    expect(p.container).toBe("mkv");
    expect(p.codec).toBe("ffv1");
    expect(p.budget).toBeNull();
  });
  it("never upsamples fps or resolution in custom mode", () => {
    const p = buildPlan(req({ mode: "custom", custom: { codec: "h264", targetSizeMB: 9.5, maxBitrateKbps: null, resolution: 2160, fps: 60 } }), info(), null);
    expect(p.budget?.outWidth).toBe(1920);
    expect(p.budget?.outFps).toBe(30);
    expect(p.warnings.join(" ")).toMatch(/upscaling|never invented/);
  });
});
