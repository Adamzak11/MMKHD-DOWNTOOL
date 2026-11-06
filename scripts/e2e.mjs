#!/usr/bin/env node
/**
 * End-to-end test against a running server (default http://localhost:3000).
 * Uploads fixtures, runs real compression jobs, downloads the outputs and
 * independently verifies them with ffprobe.
 *
 *   npm run test:fixtures   # once, generates ./fixtures
 *   npm run build && npm start &
 *   npm run test:e2e [-- --only=5s,strict] [--base=http://host:port]
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const BASE = args.base || process.env.E2E_BASE || "http://localhost:3000";
const ONLY = args.only ? args.only.split(",") : null;
const FIX = path.resolve("fixtures");
const OUT = await fsp.mkdtemp(path.join(os.tmpdir(), "mk-e2e-"));
let cookie = "";

async function req(method, url, body, headers = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body && !(body instanceof Uint8Array) && typeof body !== "object" ? {} : {}), ...headers },
    body,
    duplex: body && typeof body.pipe === "function" ? "half" : undefined,
  });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return res;
}
async function jsonReq(method, url, data) {
  const res = await req(method, url, data ? JSON.stringify(data) : undefined, { "Content-Type": "application/json" });
  const j = await res.json().catch(() => null);
  return { status: res.status, body: j };
}
async function upload(name) {
  const p = path.join(FIX, name);
  const stream = fs.createReadStream(p);
  const res = await req("POST", "/api/upload", stream, { "x-file-name": encodeURIComponent(name), "content-length": String(fs.statSync(p).size) });
  return { status: res.status, body: await res.json() };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitJob(id) {
  for (;;) {
    const { status, body } = await jsonReq("GET", `/api/jobs/${id}`);
    if (status !== 200) throw new Error(`job poll HTTP ${status}: ${body?.error}`);
    if (["done", "failed", "cancelled", "rejected"].includes(body.status)) return body;
    await sleep(1000);
  }
}
function ffprobe(p) {
  return JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", p]).toString());
}
function sha(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}
async function download(fileId, dest) {
  const res = await req("GET", `/api/files/${fileId}/media?download=1`);
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  await fsp.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return { disposition: res.headers.get("content-disposition") };
}
const rate = (r) => { const [a, b] = (r || "0/1").split("/").map(Number); return b ? a / b : a; };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ✔" : "  ✘"} ${name}${detail ? " — " + detail : ""}`);
}

const MB = 1_000_000;
const base = { qualityPreference: "balanced", targetSizeMB: 9.5, codec: "auto", audio: { mode: "auto", bitrateKbps: 128 }, qualityGuard: true, vmaf: false };
const CASES = [
  { id: "5s-smart", file: "5s_1080p_audio.mp4", req: { mode: "smart" } },
  { id: "15s-smart", file: "15s_1080p_audio.mp4", req: { mode: "smart" } },
  { id: "30s-strict", file: "30s_1080p_audio.mp4", req: { mode: "strict" } },
  { id: "60s-strict", file: "60s_1080p_audio.mp4", req: { mode: "strict" } },
  { id: "60s-smart-8mb", file: "60s_1080p_audio.mp4", req: { mode: "smart", targetSizeMB: 8 } },
  { id: "4k-strict", file: "10s_4k_audio.mp4", req: { mode: "strict" } },
  { id: "highmotion-strict", file: "10s_highmotion_1080p60.mp4", req: { mode: "strict" }, allowReject: true },
  { id: "lowlight-smart", file: "15s_lowlight_1080p.mp4", req: { mode: "smart" } },
  { id: "noaudio-strict", file: "15s_1080p_noaudio.mp4", req: { mode: "strict", targetSizeMB: 5 } },
  { id: "rotated-smart", file: "5s_rotated.mov", req: { mode: "smart" } },
  { id: "vertical-h265", file: "8s_vertical.mov", req: { mode: "strict", codec: "h265" } },
  { id: "mkv-vp9-opus", file: "10s_vp9_opus.mkv", req: { mode: "smart" } },
  { id: "small-remux", file: "6s_720p_small.mp4", req: { mode: "smart" } },
  { id: "hevc10-smart", file: "6s_hevc_10bit.mp4", req: { mode: "smart" } },
  { id: "lossless", file: "5s_1080p_audio.mp4", req: { mode: "lossless", lossless: { container: "auto" } }, lossless: true },
  { id: "lossless-mkv", file: "6s_720p.webm", req: { mode: "lossless", lossless: { container: "mkv" } }, lossless: true },
  { id: "custom-720p-30-av1", file: "10s_highmotion_1080p60.mp4", req: { mode: "custom", custom: { codec: "av1", targetSizeMB: 5, maxBitrateKbps: null, resolution: 720, fps: 30 } }, allowReject: true },
  { id: "custom-crf", file: "15s_1080p_audio.mp4", req: { mode: "custom", custom: { codec: "h264", targetSizeMB: null, maxBitrateKbps: 3000, resolution: null, fps: null } } },
  { id: "unrealistic", file: "10s_4k_audio.mp4", req: { mode: "strict", targetSizeMB: 0.5 }, expect: "rejected" },
  { id: "audio-remove", file: "15s_1080p_audio.mp4", req: { mode: "strict", audio: { mode: "remove", bitrateKbps: 128 } } },
];

async function runCase(c) {
  console.log(`\n▶ ${c.id} (${c.file})`);
  const srcPath = path.join(FIX, c.file);
  const srcHash = sha(srcPath);
  const up = await upload(c.file);
  if (up.status !== 201) return check(`${c.id}: upload`, false, JSON.stringify(up.body));
  const request = { ...base, ...c.req, fileId: up.body.id };
  const t0 = Date.now();
  const start = await jsonReq("POST", "/api/jobs", request);
  if (start.status !== 202) return check(`${c.id}: start`, false, JSON.stringify(start.body));
  const job = await waitJob(start.body.id);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const target = c.req.mode === "custom" ? c.req.custom.targetSizeMB : c.req.mode === "lossless" ? null : request.targetSizeMB;

  if (c.expect === "rejected") {
    check(`${c.id}: stopped before encoding`, job.status === "rejected" && job.compress == null, `${job.status} in ${secs}s — ${job.explanation?.slice(0, 140)}…`);
    check(`${c.id}: alternatives offered`, job.alternatives.length > 0, job.alternatives.map((a) => a.label).join(" | "));
    return;
  }
  if (job.status === "rejected" && c.allowReject) {
    check(`${c.id}: quality guard stopped honestly`, !!job.explanation, `${secs}s · ${job.explanation?.slice(0, 160)}`);
    check(`${c.id}: alternatives offered`, job.alternatives.length > 0, job.alternatives.map((a) => a.label).join(" | "));
    return;
  }
  if (job.status !== "done") return check(`${c.id}: job done`, false, `${job.status}: ${job.error ?? job.explanation}`);
  const r = job.compress;
  const dest = path.join(OUT, `${c.id}.${r.plan.container}`);
  const dl = await download(r.outputFileId, dest);
  const size = fs.statSync(dest).size;
  const pr = ffprobe(dest);
  const v = pr.streams.find((s) => s.codec_type === "video");
  const a = pr.streams.find((s) => s.codec_type === "audio");
  const src = ffprobe(srcPath);
  const sv = src.streams.find((s) => s.codec_type === "video");
  const sa = src.streams.find((s) => s.codec_type === "audio");
  const dur = parseFloat(pr.format.duration);
  const bitrate = (size * 8) / dur;
  const m = r.metrics;
  console.log(`    ${secs}s · ${(size / MB).toFixed(3)} MB · ${(bitrate / 1e6).toFixed(2)} Mbps · ${v.codec_name} ${v.width}x${v.height} @ ${rate(v.avg_frame_rate).toFixed(3)} · attempts ${r.attempts.length} · ${m ? `SSIM ${m.ssim?.toFixed?.(4)} PSNR ${m.psnr?.toFixed?.(2)} (${m.coverage})` : "no metrics"}`);

  check(`${c.id}: downloaded size equals reported size`, size === r.outputInfo.size, `${size} vs ${r.outputInfo.size}`);
  check(`${c.id}: attachment header`, /attachment/.test(dl.disposition || ""), dl.disposition);
  if (target) check(`${c.id}: under ${target} MB`, size <= target * MB, `${size} bytes`);
  if (!c.lossless) check(`${c.id}: average bitrate < 10 Mbps`, bitrate < 10e6, `${(bitrate / 1e6).toFixed(2)} Mbps`);
  check(`${c.id}: reported bitrate accurate (±1%)`, Math.abs(r.outputInfo.bitrate - bitrate) / bitrate < 0.01, `${r.outputInfo.bitrate} vs ${Math.round(bitrate)}`);
  check(`${c.id}: duration preserved`, Math.abs(dur - parseFloat(src.format.duration)) < 0.25, `${dur.toFixed(3)} vs ${parseFloat(src.format.duration).toFixed(3)}`);
  const wantFps = c.req.custom?.fps ?? rate(sv.avg_frame_rate);
  check(`${c.id}: FPS ${c.req.custom?.fps ? "as requested" : "preserved"}`, Math.abs(rate(v.avg_frame_rate) - wantFps) < 0.05, `${rate(v.avg_frame_rate).toFixed(3)} vs ${wantFps.toFixed(3)}`);
  if (!c.req.custom?.resolution) {
    const rot = (s) => Math.abs((s.side_data_list || []).find((d) => d.rotation !== undefined)?.rotation ?? 0) % 180 === 90;
    const disp = (s) => (rot(s) ? [s.height, s.width] : [s.width, s.height]).join("x");
    check(`${c.id}: resolution preserved (display)`, disp(v) === disp(sv), `${disp(v)} vs ${disp(sv)}`);
  } else {
    check(`${c.id}: resolution as requested`, Math.min(v.width, v.height) === c.req.custom.resolution, `${v.width}x${v.height}`);
  }
  const wantAudio = !!sa && c.req.audio?.mode !== "remove";
  check(`${c.id}: audio ${wantAudio ? "present" : "absent"}`, !!a === wantAudio);
  if (a && v) {
    const vs = parseFloat(v.start_time || 0), as = parseFloat(a.start_time || 0);
    const vd = parseFloat(v.duration || dur), ad = parseFloat(a.duration || dur);
    check(`${c.id}: A/V sync (start offset < 50 ms, length diff < 100 ms)`, Math.abs(vs - as) < 0.05 && Math.abs(vd - ad) < 0.1, `start Δ ${((vs - as) * 1000).toFixed(1)} ms, length Δ ${((vd - ad) * 1000).toFixed(1)} ms`);
  }
  // Fully decodable (catches truncated / corrupt output)
  try {
    execFileSync("ffmpeg", ["-v", "error", "-xerror", "-i", dest, "-f", "null", "-"], { stdio: "pipe" });
    check(`${c.id}: output decodes without errors`, true);
  } catch (e) {
    check(`${c.id}: output decodes without errors`, false, String(e.stderr).slice(0, 200));
  }
  if (c.lossless) check(`${c.id}: bit-exact frames`, m?.bitExact === true, m?.note);
  else if (r.plan.codec !== "copy" && m) check(`${c.id}: quality guard passed`, r.qualityPassed === true, `SSIM ${m.ssim}`);
  // Original untouched (local file and server copy)
  check(`${c.id}: local original untouched`, sha(srcPath) === srcHash);
  const srvSrc = path.join(OUT, `${c.id}.src`);
  await download(up.body.id, srvSrc);
  check(`${c.id}: server copy of original untouched`, sha(srvSrc) === srcHash);
  await fsp.rm(srvSrc);
}

async function negatives() {
  console.log("\n▶ negative cases");
  const bad = await upload("not_a_video.mp4");
  check("invalid file rejected (415)", bad.status === 415, bad.body.error);
  const res = await req("POST", "/api/upload", new Uint8Array([1, 2, 3]), { "x-file-name": "evil.exe" });
  check("disallowed extension rejected (415)", res.status === 415, (await res.json()).error);
  const trav = await jsonReq("GET", "/api/files/..%2f..%2fetc%2fpasswd");
  check("path traversal id rejected", trav.status === 404 || trav.status === 400, String(trav.status));
  const bogus = await jsonReq("POST", "/api/jobs", { fileId: "0".repeat(32), mode: "smart" });
  check("unknown file id → 404", bogus.status === 404, bogus.body?.error);
  const badReq = await jsonReq("POST", "/api/jobs", { fileId: "x", mode: "turbo" });
  check("schema validation → 400", badReq.status === 400, badReq.body?.error);
  // Ownership: a different session cannot see this session's file
  const good = await upload("6s_720p_small.mp4");
  const mine = cookie;
  cookie = "";
  const other = await jsonReq("GET", `/api/files/${good.body.id}`);
  check("other session cannot access file (404)", other.status === 404, String(other.status));
  const otherMedia = await req("GET", `/api/files/${good.body.id}/media`);
  check("other session cannot stream file (404)", otherMedia.status === 404);
  cookie = mine;
  // Range request
  const rr = await req("GET", `/api/files/${good.body.id}/media`, undefined, { range: "bytes=0-99" });
  check("HTTP range request → 206 with 100 bytes", rr.status === 206 && (await rr.arrayBuffer()).byteLength === 100);
  // Frame extraction
  const fr = await req("GET", `/api/files/${good.body.id}/frame?t=1.5`);
  const png = Buffer.from(await fr.arrayBuffer());
  check("frame inspector returns PNG", fr.status === 200 && png.subarray(1, 4).toString() === "PNG", `${png.length} bytes`);
  // Cancellation
  const big = await upload("60s_1080p_audio.mp4");
  const j = await jsonReq("POST", "/api/jobs", { ...base, mode: "strict", fileId: big.body.id });
  await sleep(4000);
  await jsonReq("DELETE", `/api/jobs/${j.body.id}`);
  const fin = await waitJob(j.body.id);
  check("job cancellation kills processing", fin.status === "cancelled", fin.status);
  // TikTok URL validation (no network needed)
  const tt = await jsonReq("POST", "/api/tiktok/resolve", { url: "https://example.com/video/1" });
  check("non-TikTok URL rejected", tt.status === 400, tt.body?.error);
  const tt2 = await jsonReq("POST", "/api/tiktok/resolve", { url: "https://www.tiktok.com/@someone" });
  check("profile URL rejected", tt2.status === 400, tt2.body?.error);
  const tt3 = await jsonReq("POST", "/api/tiktok/retrieve", { url: "https://www.tiktok.com/@a/video/7300000000000000000", formatId: "x", rightsConfirmed: false });
  check("retrieval requires rights confirmation", tt3.status === 400, tt3.body?.error);
}

// Establish the session cookie once before running workers in parallel.
await jsonReq("GET", "/api/capabilities");
const selected = CASES.filter((c) => !ONLY || ONLY.includes(c.id));
const CONC = Number(args.concurrency || 2);
const queue = [...selected];
await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) await runCase(queue.shift()).catch((e) => check(`crash`, false, e.stack)); }));
if (!ONLY || ONLY.includes("neg")) await negatives();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Outputs in ${OUT}`);
if (failed.length) {
  console.log("Failures:");
  for (const f of failed) console.log(`  ✘ ${f.name} — ${f.detail}`);
  process.exit(1);
}
