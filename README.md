# MAMATKILAT VIDEO TOOLS

**Compress videos intelligently. Preserve quality. Download and process videos in one place.**

An all-in-one video utility platform: a Smart Video Compressor (under 10 MB with the best quality the bitrate allows), a Quality Guard (SSIM / PSNR / optional VMAF), a Video Analyzer, a before/after comparison tool and an authorized TikTok retrieval module that hands videos straight to the compressor.

Every processing step is real: FFmpeg encodes, FFprobe verifies, and the output's actual size is checked before it is offered for download. Nothing is simulated.

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [How the compressor works](#how-the-compressor-works)
- [TikTok retrieval](#tiktok-retrieval)
- [Security](#security)
- [Deployment](#deployment)
- [Testing](#testing)
- [Known limitations](#known-limitations)

---

## Features

| Module | What it does |
| --- | --- |
| **A. Smart Video Compressor** | Four modes — **Smart Quality** (default), **Strict Under Target**, **Lossless**, **Custom**. Target presets 5 / 8 / 9.5 / 10 MB or any custom size. Live bitrate calculator, codec recommendation (H.264 / H.265 / AV1 with availability detection), 2-pass encoding, retry engine, Quality Guard, audio options (keep / AAC / remove — never removed automatically). |
| **Quality Guard** | Measures SSIM and PSNR (and VMAF when FFmpeg has `libvmaf`) of the output against the source. Three preferences with explicit thresholds. Stops instead of returning an over-compressed file, explains why and offers alternative settings. |
| **Before & After** | Synchronised side-by-side playback (one control drives both players) and a **Frame inspector** that decodes the exact same frame from both files on the server as lossless PNG — split slider or side-by-side, Fit or 100% zoom, frame stepping. Works for codecs the browser cannot play (HEVC, AV1, FFV1). Metadata comparison table. |
| **B. TikTok HD Downloader** | URL validation (standard, mobile, `vm.`/`vt.` short links), metadata via TikTok's **official oEmbed** API, genuine source qualities only, rights confirmation, watermark rules, real download progress, FFprobe verification, one-click handoff to the compressor. |
| **C. Video Analyzer** | Resolution (rotation-aware), FPS (VFR detection), codecs, profiles, bitrates, aspect ratio, pixel format / bit depth, frame count, colour metadata, audio sample rate / channels / bitrate. Copy as text report or JSON. |
| **D. Workflow & history** | Retrieve → Compress → Compare → Download. Per-session job history and workspace files, automatic expiry. |

### Brand & UI

Premium dark interface built around a neon-volt accent (`#EFFF00`) used sparingly — active navigation, primary actions, progress and key numbers. Inter (self-hosted via Fontsource), tabular numerals for all technical readouts, rounded cards on `#1C1C1C`, a lightning-bolt-through-M logo mark ("kilat" = lightning). Desktop: sidebar navigation, two-column workspace. Mobile: sticky top bar, bottom navigation, stacked full-width cards.

---

## Architecture

```
Browser (Next.js App Router, React 19, Tailwind 4, Framer Motion, Lucide)
   │  streaming upload (XHR, raw body)          polling /api/jobs/:id
   ▼
Next.js Route Handlers (Node runtime) ── src/app/api/*
   │  session cookie (HMAC-signed, httpOnly) → ownership of files & jobs
   │  zod validation · rate limiting · size / duration limits
   ▼
src/server/
   ├─ jobs.ts            in-process queue, concurrency limit, cancellation, timeouts, janitor
   ├─ compressor/engine  plan → sample → encode (1/2-pass) → verify → Quality Guard → retry
   ├─ quality.ts         SSIM / PSNR / VMAF filtergraphs, lossless frame-hash verification
   ├─ ffprobe.ts         metadata extraction → src/lib/probe-parse.ts
   ├─ process.ts         spawn() with argument arrays (no shell), -progress parsing, kill on cancel
   ├─ storage.ts         random 128-bit ids, per-file dirs, TTL cleanup, no paths exposed
   └─ tiktok/service.ts  URL expansion (TikTok hosts only), oEmbed, provider adapters
src/lib/plan.ts          pure planning logic (bitrate budget, feasibility, codec choice, alternatives)
                         shared by server (authoritative) and client (live calculator)
```

Long-running FFmpeg work happens inside the persistent Node server process. **This requires a server or container host — not short-lived serverless functions** (see [Deployment](#deployment)).

---

## Requirements

- Node.js ≥ 20.9 (tested on 22)
- FFmpeg + FFprobe ≥ 5 with `libx264` (required), `libx265` (H.265), `libsvtav1` or `libaom` (AV1), `ffv1`, native `aac`. Encoders and the `ssim` / `psnr` / `libvmaf` filters are detected at runtime; unavailable options are disabled in the UI.
- Disk space for temporary files (roughly 3× the largest upload).

Tested with FFmpeg 6.1.1 (Ubuntu 24.04 build: x264, x265, SVT-AV1, libaom; no libvmaf).

---

## Quick start

```bash
npm install
cp .env.example .env        # set SESSION_SECRET (openssl rand -hex 32)
npm run dev                 # http://localhost:3000

# production
npm run build
npm start
```

---

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `SESSION_SECRET` | random per process | **Required in production.** Signs the anonymous session cookie that owns files and jobs. ≥ 16 chars. |
| `DATA_DIR` | `./data` | Uploads, outputs and per-job work directories. Use an absolute path in containers. |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | Binaries. |
| `MAX_UPLOAD_MB` | `2048` | Per-file upload limit (1 MB = 1,000,000 bytes). |
| `MAX_DURATION_SEC` | `900` | Longest video accepted. |
| `JOB_TIMEOUT_SEC` | `3600` | Hard time limit per job (FFmpeg is killed). |
| `MAX_CONCURRENT_JOBS` | `1` | FFmpeg jobs running at once. Each job uses all cores. |
| `MAX_QUEUED_JOBS_PER_SESSION` | `3` | Queued + running jobs one session may have. |
| `FILE_TTL_MIN` | `60` | Files are deleted this many minutes after creation. |
| `FFMPEG_THREADS` | `0` | `0` = FFmpeg decides. |
| `INSECURE_COOKIES` | `false` | Set `true` only when serving production over plain HTTP (e.g. LAN testing). |
| `TIKTOK_PROVIDER_URL` | — | Endpoint of an authorized media provider (see below). |
| `TIKTOK_PROVIDER_TOKEN` | — | Bearer token sent to that provider. |
| `TIKTOK_YTDLP_ENABLED` | `false` | Operator opt-in public-page extractor. |
| `YTDLP_PATH` | `yt-dlp` | Path to yt-dlp when enabled. |
| `MAX_DOWNLOAD_MB` | `500` | Size limit for retrieved videos. |

---

## How the compressor works

### 1. Analysis
FFprobe extracts duration, display resolution (rotation and sample aspect ratio applied), FPS (VFR detection), codecs and profiles, bitrates (derived when the container does not store them), pixel format and bit depth, colour metadata and frame count.

### 2. Bitrate calculator
```
total bitrate (bps) = min( target bytes × 8 / duration , 10 Mbps × 0.99 )
video bitrate       = total − audio − container overhead − 2% safety
```
Container overhead is estimated from MP4 sample-table cost (≈ 12 bytes per video frame and per AAC frame, plus a 16 KB header), doubled to be conservative. The **average bitrate must stay below 10 Mbps**, so very short clips get a smaller effective size limit (`sizeLimitBytes`). The estimate only plans the encode — the real output size is always measured.

Feasibility is graded from bits-per-pixel (`video bps / (width × height × fps)`), adjusted for codec efficiency (H.265 ≈ 0.65×, AV1 ≈ 0.55× of H.264): comfortable ≥ 0.10, good ≥ 0.06, tight ≥ 0.035, very tight ≥ 0.012, otherwise unrealistic.

### 3. Modes
- **Smart Quality** — if the source already fits (size, ≤ 10 Mbps, MP4-compatible codecs) it is **stream-copied** with no re-encode. Otherwise it encodes 3–4 two-second samples at the quality-targeted CRF to learn what this content needs. If the projection (+15% margin) fits, a capped CRF encode is used — often well under the target with excellent quality. If not, or if Quality Guard rejects it, it falls back to 2-pass at the full budget.
- **Strict Under Target** — 2-pass ABR at the computed bitrate (single-pass VBR for AV1), default 9.5 MB.
- **Lossless** — H.264 `-qp 0` in MP4 when the pixel format allows it, otherwise FFV1 in MKV. Pixel format is never converted, audio is copied bit-exact (or stored as ALAC). Output is verified by hashing every decoded frame of source and output. No target size; output is usually *larger*.
- **Custom** — codec, optional target size, maximum bitrate, resolution (short side, never upscaled), FPS (never increased), audio.

### 4. Retry engine (max 4 attempts)
1. Encode, probe the output (video/audio present, duration within tolerance).
2. **Over the limit** → correct the bitrate by the *measured* overshoot and retry.
3. **Under the limit** → Quality Guard. Pass → done (if it undershot by > 12%, one retry raises the bitrate to use the budget; the best passing result is kept).
4. **Quality below threshold** → the bitrate is *not* blindly lowered. Instead: switch to H.265 (when codec is Auto), then a slower preset.
5. Still failing → stop, explain with the measured numbers, offer alternatives (H.265, downscale, 30 FPS, lower audio bitrate, a larger target computed for "good" quality). The below-threshold file is offered only behind an explicit "download anyway" button.

Resolution and FPS are **never** reduced silently — only through the Custom mode or an alternative the user clicks. Unrealistic targets are refused before encoding.

### 5. Quality Guard thresholds
| Preference | CRF (x264 / x265 / AV1) | Gate |
| --- | --- | --- |
| High | 18 / 20 / 27 | SSIM ≥ 0.960 |
| Balanced | 21 / 23 / 32 | SSIM ≥ 0.930 |
| Maximum compression | 25 / 27 / 38 | SSIM ≥ 0.880 |

SSIM is computed on all planes; PSNR (average & minimum, dB) and VMAF (0–100) are reported separately. The UI never presents them as interchangeable or as a "quality %". Long or large videos are measured on 8 evenly spaced 2-second segments and the coverage is shown.

### 6. Output
MP4 (`+faststart`), H.264 High / H.265 Main(10) tagged `hvc1` / AV1. `yuv420p` sources are not colour-converted; 10-bit is kept for H.265/AV1; H.264 converts other formats to `yuv420p` for compatibility (shown in the plan). VFR timestamps are preserved.

---

## TikTok retrieval

**Only content the user owns or has permission to download and reuse is supported.** DRM, private videos, access controls and platform security are never bypassed.

What works out of the box:
- URL validation and normalisation (`/@user/video/<id>`, `m.tiktok.com`, `vm.`/`vt.tiktok.com`, `/t/<code>`). Short links are expanded by following redirects **only to TikTok hosts**.
- Metadata (title, creator, thumbnail) from TikTok's official public **oEmbed** endpoint `https://www.tiktok.com/oembed`. Private, deleted or restricted videos return nothing and are reported as such. Missing metadata is shown as "Not provided" — never invented.

What needs configuration — **media files**. TikTok's official APIs do not provide downloadable video files for arbitrary posts: oEmbed returns metadata only, and the Display API (Login Kit, `video.list`) returns metadata/embeds for the logged-in creator's own videos, not media files. Without a provider the UI states clearly that retrieval is unavailable and why. Two adapters are included:

### Option A — authorized provider (recommended)
Set `TIKTOK_PROVIDER_URL` (+ `TIKTOK_PROVIDER_TOKEN`) to a licensed media API you have a contract with, or to your own service in front of one. Contract:

```http
POST {TIKTOK_PROVIDER_URL}
Authorization: Bearer {TIKTOK_PROVIDER_TOKEN}
Content-Type: application/json

{ "url": "https://www.tiktok.com/@creator/video/7300000000000000000" }
```
```json
{
  "title": "optional", "author": "optional", "duration": 12.3, "thumbnail": "https://…",
  "formats": [
    { "id": "hd", "url": "https://…/video.mp4", "width": 1080, "height": 1920, "ext": "mp4",
      "filesize": 8123456, "watermark": true, "vcodec": "h264", "bitrate_kbps": 5200 }
  ]
}
```
`404` → unavailable/deleted, `403` → private/restricted. Format URLs must be `https://`. `watermark: false` formats are only released after the user confirms they are the creator or have explicit permission; formats with unreported watermark status are treated the same way.

### Option B — public-page extractor (operator opt-in)
`TIKTOK_YTDLP_ENABLED=true` with [yt-dlp](https://github.com/yt-dlp/yt-dlp) installed (`docker build --build-arg INSTALL_YTDLP=true`). Only public videos; yt-dlp errors for private / login-gated / region-blocked / deleted videos are mapped to clear messages. **This is not an official TikTok API — the operator is responsible for compliance with TikTok's Terms of Service and local law.** Disabled by default.

### Rules enforced server-side
- Every retrieval requires `rightsConfirmed: true`.
- Format ids are accepted only if they came from the server's own resolve step (cached per session for 15 min).
- Watermark-free / unknown-watermark formats require `ownerConfirmed: true`; otherwise only watermarked formats are released.
- Only genuine source qualities are listed; nothing is upscaled or relabelled HD.
- Downloads are size-limited and verified with FFprobe; attribution (creator, URL) is stored with the file.

---

## Security

- **Ownership** — an HMAC-signed, httpOnly, SameSite=Lax session cookie identifies the browser. Every file and job is tagged with it; foreign ids return 404 (indistinguishable from non-existent).
- **No filesystem exposure** — files are addressed by random 128-bit hex ids validated by regex; user filenames are sanitised and used only for display / `Content-Disposition`.
- **Safe FFmpeg** — `spawn()` with argument arrays (never a shell); every numeric parameter is validated by zod and generated server-side; inputs are internal absolute paths.
- **Uploads** — streamed straight to disk with a byte limit enforced during the stream; extension allow-list **and** FFprobe content validation (must contain a video stream); duration limit.
- **Resource limits** — job queue with concurrency limit, per-session queue limit, per-job timeout (process killed), token-bucket rate limits on upload / job / frame / TikTok endpoints.
- **Cleanup** — files expire after `FILE_TTL_MIN`; per-job work dirs are removed when the job ends; a janitor removes orphans every 5 minutes.
- **SSRF** — short-link expansion only follows `https` redirects to TikTok hosts; provider media URLs must be `https`.
- Headers: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`; `X-Powered-By` disabled.

---

## Deployment

FFmpeg jobs can run for minutes and need CPU, RAM and local disk. Use a **persistent server or container**: a VPS, Docker host, Fly.io Machines, Railway, Render (web service), AWS ECS/EC2, Google Cloud Run *with a long request timeout and always-on CPU*, Kubernetes. **Do not** deploy to short-lived serverless functions (e.g. Vercel/Netlify functions) — they have execution limits, no FFmpeg and ephemeral disks between invocations.

### Docker
```bash
cp .env.example .env    # set SESSION_SECRET
docker compose up --build -d
# or
docker build -t mamatkilat .            # add --build-arg INSTALL_YTDLP=true for Option B
docker run -p 3000:3000 --env-file .env -v mamat-data:/data mamatkilat
```
The image uses Debian's FFmpeg (x264, x265, SVT-AV1, libaom). Put it behind a reverse proxy (Caddy / nginx) with TLS, and raise the proxy's body size and timeouts for large uploads (e.g. nginx `client_max_body_size 2g; proxy_request_buffering off; proxy_read_timeout 3600s;`).

### Scaling notes
The job queue and job state are in-process (single instance). Files live on local disk. To run several instances, pin sessions to one instance (sticky sessions) or replace `jobs.ts`/`storage.ts` with Redis/BullMQ and object storage — the module boundaries are designed for that.

---

## Testing

```bash
npm test                 # unit tests (bitrate calculator, planner, URL parser, probe parser)
npm run typecheck
npm run test:fixtures    # generates ./fixtures (synthetic test videos, ~1 GB)
npm run build && npm start &
npm run test:e2e         # real uploads → real encodes → independent ffprobe verification
npm run test:e2e -- --only=5s-smart,lossless,neg
```

The e2e suite uploads each fixture, runs the job, downloads the output and checks with its own `ffprobe`/`ffmpeg`: size under target, average bitrate < 10 Mbps, reported bitrate accurate, duration, FPS and resolution preserved (or as requested), audio present/absent as requested, A/V start offset & length, full decode without errors, Quality Guard verdict, lossless bit-exactness, and that the original file (local and server copy) is byte-identical afterwards. Negative cases: invalid file, disallowed extension, path traversal, unknown ids, schema validation, cross-session access, HTTP range, frame extraction, cancellation, TikTok URL validation and rights enforcement.

Fixtures: 5 s / 15 s / 30 s / 60 s 1080p with audio, 10 s 4K, 10 s 1080p60 high-motion (heavy temporal noise — a deliberate worst case), 15 s low-light, 15 s without audio, vertical MOV, rotated MOV, VP9/Opus MKV, WebM, an already-small MP4 (stream-copy path), 10-bit HEVC, and a non-video file.

TEST_RESULTS_PLACEHOLDER

---

## Known limitations

- **TikTok media retrieval needs a configured provider.** Without one, only validation and official oEmbed metadata work (stated in the UI). It could not be tested against live TikTok in the development sandbox (outbound access to tiktok.com was blocked); the URL validation, rights enforcement and error paths are covered by tests.
- VMAF requires an FFmpeg build with `libvmaf`; the stock Ubuntu/Debian builds do not include it, so the option is shown as unavailable.
- Browser preview of HEVC/AV1/MKV depends on the browser; the Frame inspector always works because frames are decoded server-side.
- Quality metrics are objective proxies. Synthetic heavy noise (the high-motion fixture) is close to incompressible, so tight targets are rightly rejected there; real camera footage generally scores higher at the same bitrate.
- Single-instance job queue (see Scaling notes).
