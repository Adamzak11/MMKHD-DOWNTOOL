// Shared types between the server (route handlers / engine) and the client UI.

export type VideoCodecChoice = "h264" | "h265" | "av1";
export type CompressionMode = "lossless" | "smart" | "strict" | "custom";
export type QualityPreference = "high" | "balanced" | "max";
export type AudioMode = "auto" | "copy" | "aac" | "remove";

export interface VideoStreamInfo {
  index: number;
  codec: string;
  codecLong: string | null;
  profile: string | null;
  /** Coded size as stored in the stream */
  codedWidth: number;
  codedHeight: number;
  /** Display size after rotation metadata and sample aspect ratio are applied */
  width: number;
  height: number;
  rotation: number;
  fps: number | null;
  avgFps: number | null;
  isVfr: boolean;
  bitrate: number | null;
  pixFmt: string | null;
  bitDepth: number | null;
  sampleAspectRatio: string | null;
  displayAspectRatio: string | null;
  frameCount: number | null;
  colorSpace: string | null;
  colorPrimaries: string | null;
  colorTransfer: string | null;
  colorRange: string | null;
}

export interface AudioStreamInfo {
  index: number;
  codec: string;
  codecLong: string | null;
  profile: string | null;
  sampleRate: number | null;
  channels: number | null;
  channelLayout: string | null;
  bitrate: number | null;
  /** true when the bitrate was derived rather than read from the stream */
  bitrateEstimated: boolean;
}

export interface MediaInfo {
  formatName: string;
  formatLong: string | null;
  duration: number;
  size: number;
  /** Overall container bitrate (bits/s) */
  bitrate: number | null;
  video: VideoStreamInfo | null;
  audio: AudioStreamInfo | null;
  audioStreamCount: number;
  subtitleStreamCount: number;
}

export interface StoredFileSummary {
  id: string;
  name: string;
  size: number;
  kind: "upload" | "output" | "retrieved";
  createdAt: number;
  expiresAt: number;
  mime: string;
  info: MediaInfo | null;
  /** Attribution for retrieved content (creator, source URL) */
  attribution?: { source: string; author?: string | null; title?: string | null; url: string } | null;
}

export interface Capabilities {
  ffmpegVersion: string | null;
  encoders: { h264: boolean; h265: boolean; av1: boolean; av1Encoder: string | null; ffv1: boolean; aac: boolean; alac: boolean };
  metrics: { ssim: boolean; psnr: boolean; vmaf: boolean };
  limits: { maxUploadMB: number; maxDurationSec: number; fileTtlMin: number; maxDownloadMB: number };
  tiktok: { oembed: boolean; providers: { id: string; label: string; enabled: boolean; reason?: string }[] };
}

export interface CustomSettings {
  codec: VideoCodecChoice | "auto";
  targetSizeMB: number | null;
  maxBitrateKbps: number | null;
  /** short side in pixels, or null to keep the source resolution */
  resolution: number | null;
  /** null keeps source FPS */
  fps: number | null;
}

export interface CompressRequest {
  fileId: string;
  mode: CompressionMode;
  qualityPreference: QualityPreference;
  targetSizeMB: number;
  codec: VideoCodecChoice | "auto";
  audio: { mode: AudioMode; bitrateKbps: number };
  custom?: CustomSettings;
  lossless?: { container: "auto" | "mp4" | "mkv" };
  /** Quality Guard enabled (default true) */
  qualityGuard: boolean;
  /** Also compute VMAF when the build supports it */
  vmaf: boolean;
}

export interface BudgetBreakdown {
  targetBytes: number;
  durationSec: number;
  totalBps: number;
  audioBps: number;
  overheadBps: number;
  safetyBps: number;
  videoBps: number;
  /** bits per pixel per frame at the output resolution / fps */
  bitsPerPixel: number;
  outWidth: number;
  outHeight: number;
  outFps: number;
}

export type Feasibility = "comfortable" | "good" | "tight" | "very-tight" | "unrealistic";

export interface PlanAlternative {
  label: string;
  description: string;
  apply: Partial<CompressRequest> & { custom?: Partial<CustomSettings> };
}

export interface CompressionPlan {
  mode: CompressionMode;
  codec: VideoCodecChoice | "ffv1" | "copy";
  codecReason: string;
  container: "mp4" | "mkv";
  strategy: string;
  budget: BudgetBreakdown | null;
  feasibility: Feasibility | null;
  feasibilityNote: string | null;
  audioPlan: string;
  pixFmtPlan: string;
  warnings: string[];
  alternatives: PlanAlternative[];
  canRemux: boolean;
}

export interface QualityMetrics {
  ssim: number | null; // 0..1, "All" channel
  ssimY: number | null;
  ssimDb: number | null;
  psnr: number | null; // dB average
  psnrMin: number | null;
  vmaf: number | null; // 0..100
  coverage: string; // "all frames" or "6 × 2 s segments (≈20% of frames)"
  note: string | null;
  bitExact?: boolean | null; // lossless verification result
}

export interface AttemptRecord {
  attempt: number;
  codec: string;
  strategy: string;
  videoKbps: number | null;
  crf: number | null;
  sizeBytes: number | null;
  bitrate: number | null;
  metrics: QualityMetrics | null;
  verdict: string;
}

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled" | "rejected";

export interface JobProgress {
  phase: string;
  phaseLabel: string;
  percent: number | null; // percent of the current phase, null when indeterminate
  attempt: number | null;
  maxAttempts: number | null;
  speed: string | null;
  etaSec: number | null;
}

export interface CompressionResult {
  outputFileId: string;
  sourceFileId: string;
  sourceInfo: MediaInfo;
  outputInfo: MediaInfo;
  plan: CompressionPlan;
  metrics: QualityMetrics | null;
  attempts: AttemptRecord[];
  targetBytes: number | null;
  meetsTarget: boolean | null;
  qualityPassed: boolean | null;
  threshold: { ssim: number; label: string } | null;
}

export interface RetrievalResult {
  fileId: string;
  info: MediaInfo;
  size: number;
}

export interface JobSummary {
  id: string;
  type: "compress" | "retrieve";
  status: JobStatus;
  title: string;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  progress: JobProgress;
  log: { t: number; level: "info" | "warn" | "error" | "success"; msg: string }[];
  error: string | null;
  /** Shown when the job stops on purpose (quality guard / impossible target) */
  explanation: string | null;
  alternatives: PlanAlternative[];
  queuePosition: number | null;
  compress?: CompressionResult | null;
  /** best attempt that failed the quality guard, offered explicitly */
  rejectedOutput?: { fileId: string; size: number; metrics: QualityMetrics | null } | null;
  retrieve?: RetrievalResult | null;
  request?: CompressRequest | null;
}

export interface TikTokFormat {
  id: string;
  label: string;
  width: number | null;
  height: number | null;
  ext: string;
  filesize: number | null;
  /** true = has watermark, false = watermark-free, null = provider did not report */
  watermark: boolean | null;
  vcodec: string | null;
  bitrateKbps: number | null;
}

export interface TikTokResolveResult {
  canonicalUrl: string;
  videoId: string | null;
  metadata: {
    title: string | null;
    author: string | null;
    authorUrl: string | null;
    thumbnailUrl: string | null;
    duration: number | null;
    source: string; // e.g. "TikTok oEmbed"
  };
  provider: { id: string; label: string } | null;
  formats: TikTokFormat[];
  retrievalAvailable: boolean;
  retrievalNote: string | null;
}
