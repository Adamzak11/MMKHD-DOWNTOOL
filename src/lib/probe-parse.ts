import type { AudioStreamInfo, MediaInfo, VideoStreamInfo } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function parseRate(r: string | undefined | null): number | null {
  if (!r) return null;
  const [a, b] = r.split("/").map(Number);
  if (!Number.isFinite(a)) return null;
  if (b === undefined) return a > 0 ? a : null;
  if (!b || !Number.isFinite(b)) return null;
  const v = a / b;
  return v > 0 && v < 1000 ? v : null;
}

function int(v: any): number | null {
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function float(v: any): number | null {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function tag(stream: any, key: string): string | undefined {
  const tags = stream?.tags || {};
  for (const k of Object.keys(tags)) {
    if (k.toUpperCase() === key.toUpperCase() || k.toUpperCase().startsWith(key.toUpperCase() + "-")) return tags[k];
  }
  return undefined;
}

export function bitDepthFromPixFmt(pix: string | null): number | null {
  if (!pix) return null;
  const m = pix.match(/p(\d{2})(le|be)?$/);
  if (m) return parseInt(m[1], 10);
  if (/^(yuvj?4\d\dp|nv12|nv21|gray|rgb24|bgr24|yuva4\d\dp)$/.test(pix)) return 8;
  return null;
}

function rotationOf(stream: any): number {
  let rot = 0;
  for (const sd of stream?.side_data_list || []) {
    if (typeof sd.rotation === "number") rot = sd.rotation;
  }
  if (!rot) {
    const t = tag(stream, "rotate");
    if (t) rot = -parseInt(t, 10) || 0; // legacy tag is clockwise; display matrix is counter-clockwise
  }
  rot = ((Math.round(rot) % 360) + 360) % 360;
  return rot;
}

export function parseProbe(json: any, fileSize: number): MediaInfo {
  const streams: any[] = json?.streams || [];
  const fmt = json?.format || {};
  const vs = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const audios = streams.filter((s) => s.codec_type === "audio");
  const as = audios[0];
  const duration = float(fmt.duration) ?? float(vs?.duration) ?? float(as?.duration) ?? 0;
  const size = int(fmt.size) ?? fileSize;
  const overall = int(fmt.bit_rate) ?? (duration > 0 ? Math.round((size * 8) / duration) : null);

  let video: VideoStreamInfo | null = null;
  if (vs) {
    const cw = int(vs.width) ?? 0;
    const ch = int(vs.height) ?? 0;
    const rotation = rotationOf(vs);
    let w = cw;
    let h = ch;
    const sar = vs.sample_aspect_ratio && vs.sample_aspect_ratio !== "0:1" ? vs.sample_aspect_ratio : null;
    if (sar && sar !== "1:1") {
      const [sn, sd] = sar.split(":").map(Number);
      if (sn > 0 && sd > 0) w = Math.round((cw * sn) / sd / 2) * 2;
    }
    if (rotation === 90 || rotation === 270) [w, h] = [h, w];
    const rFps = parseRate(vs.r_frame_rate);
    const aFps = parseRate(vs.avg_frame_rate);
    const fps = aFps ?? rFps;
    const pixFmt = vs.pix_fmt ?? null;
    video = {
      index: vs.index,
      codec: vs.codec_name ?? "unknown",
      codecLong: vs.codec_long_name ?? null,
      profile: vs.profile ?? null,
      codedWidth: cw,
      codedHeight: ch,
      width: w,
      height: h,
      rotation,
      fps,
      avgFps: aFps,
      isVfr: !!(rFps && aFps && Math.abs(rFps - aFps) / rFps > 0.01),
      bitrate: int(vs.bit_rate) ?? int(tag(vs, "BPS")) ?? null,
      pixFmt,
      bitDepth: int(vs.bits_per_raw_sample) ?? bitDepthFromPixFmt(pixFmt),
      sampleAspectRatio: sar,
      displayAspectRatio: vs.display_aspect_ratio && vs.display_aspect_ratio !== "0:1" ? vs.display_aspect_ratio : null,
      frameCount: int(vs.nb_frames) ?? int(tag(vs, "NUMBER_OF_FRAMES")) ?? null,
      colorSpace: vs.color_space ?? null,
      colorPrimaries: vs.color_primaries ?? null,
      colorTransfer: vs.color_transfer ?? null,
      colorRange: vs.color_range ?? null,
    };
  }

  let audio: AudioStreamInfo | null = null;
  if (as) {
    let br = int(as.bit_rate) ?? int(tag(as, "BPS"));
    let estimated = false;
    if (br === null && overall && video?.bitrate) {
      br = Math.max(0, overall - video.bitrate);
      estimated = true;
    }
    audio = {
      index: as.index,
      codec: as.codec_name ?? "unknown",
      codecLong: as.codec_long_name ?? null,
      profile: as.profile ?? null,
      sampleRate: int(as.sample_rate),
      channels: int(as.channels),
      channelLayout: as.channel_layout ?? null,
      bitrate: br,
      bitrateEstimated: estimated,
    };
  }
  if (video && video.bitrate === null && overall) {
    // Derive video bitrate when the container does not store it (MKV/WebM).
    video.bitrate = Math.max(0, overall - (audio?.bitrate ?? 0));
  }

  return {
    formatName: fmt.format_name ?? "unknown",
    formatLong: fmt.format_long_name ?? null,
    duration,
    size,
    bitrate: overall,
    video,
    audio,
    audioStreamCount: audios.length,
    subtitleStreamCount: streams.filter((s) => s.codec_type === "subtitle").length,
  };
}
