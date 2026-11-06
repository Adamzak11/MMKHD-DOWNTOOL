import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "@/server/config";
import { handler, HttpError, json } from "@/server/http";
import { getSessionId } from "@/server/session";
import { rateLimit } from "@/server/ratelimit";
import { allocateFile, deleteFile, extOf, mimeFor, sanitizeName, toSummary, VIDEO_EXTENSIONS, writeMeta } from "@/server/storage";
import { probe } from "@/server/ffprobe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streaming upload: the raw request body is piped straight to disk (never buffered in memory).
 * Headers: x-file-name (URI-encoded original filename), content-length (optional but checked).
 */
export const POST = handler(async (req: Request) => {
  const owner = await getSessionId();
  rateLimit(`upload:${owner}`, 10, 20);
  const rawName = decodeURIComponent(req.headers.get("x-file-name") || "");
  const name = sanitizeName(rawName);
  const ext = extOf(name);
  if (!(VIDEO_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new HttpError(415, `Unsupported file type ".${ext || "?"}". Supported: ${VIDEO_EXTENSIONS.join(", ")}`, "unsupported_type");
  }
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > config.maxUploadBytes) throw new HttpError(413, `File is larger than the ${Math.round(config.maxUploadBytes / 1e6)} MB upload limit`, "too_large");
  if (!req.body) throw new HttpError(400, "Empty upload");

  const { id, filePath } = await allocateFile(ext);
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _e, cb) {
      bytes += chunk.length;
      if (bytes > config.maxUploadBytes) return cb(new HttpError(413, `File is larger than the ${Math.round(config.maxUploadBytes / 1e6)} MB upload limit`, "too_large"));
      cb(null, chunk);
    },
  });
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pipeline(Readable.fromWeb(req.body as any), limiter, fs.createWriteStream(filePath, { mode: 0o600 }));
  } catch (err) {
    await deleteFile(id).catch(() => {});
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "Upload was interrupted", "upload_aborted");
  }
  if (bytes === 0) {
    await deleteFile(id);
    throw new HttpError(400, "The uploaded file is empty");
  }

  // Content validation: must be something FFprobe recognises as a video.
  let info;
  try {
    info = await probe(filePath);
  } catch {
    await deleteFile(id);
    throw new HttpError(415, "FFprobe could not read this file — it is not a supported or valid video.", "invalid_media");
  }
  if (!info.video || info.video.width <= 0) {
    await deleteFile(id);
    throw new HttpError(415, "This file contains no video stream.", "no_video");
  }
  if (info.duration > config.maxDurationSec) {
    await deleteFile(id);
    throw new HttpError(413, `Video is ${Math.round(info.duration)} s long; the limit on this server is ${config.maxDurationSec} s.`, "too_long");
  }
  const st = await fsp.stat(filePath);
  const now = Date.now();
  const meta = { id, owner, name, ext, size: st.size, kind: "upload" as const, mime: mimeFor(ext), createdAt: now, expiresAt: now + config.fileTtlMs, info };
  await writeMeta(meta);
  return json(toSummary(meta), { status: 201 });
});
