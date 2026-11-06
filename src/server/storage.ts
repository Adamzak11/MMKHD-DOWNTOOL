import "server-only";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config";
import { HttpError } from "./http";
import type { MediaInfo, StoredFileSummary } from "@/lib/types";

export const ID_RE = /^[a-f0-9]{32}$/;

export const VIDEO_EXTENSIONS = [
  "mp4", "m4v", "mov", "mkv", "webm", "avi", "flv", "wmv", "mpg", "mpeg", "ts", "mts", "m2ts", "3gp", "3g2", "ogv", "mxf", "asf", "vob", "y4m", "nut",
] as const;

const MIME: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska", webm: "video/webm",
  avi: "video/x-msvideo", flv: "video/x-flv", wmv: "video/x-ms-wmv", mpg: "video/mpeg", mpeg: "video/mpeg",
  ts: "video/mp2t", mts: "video/mp2t", m2ts: "video/mp2t", "3gp": "video/3gpp", "3g2": "video/3gpp2", ogv: "video/ogg",
  png: "image/png", jpg: "image/jpeg",
};

export function mimeFor(ext: string) {
  return MIME[ext] || "application/octet-stream";
}

export interface FileMeta {
  id: string;
  owner: string;
  name: string;
  ext: string;
  size: number;
  kind: StoredFileSummary["kind"];
  mime: string;
  createdAt: number;
  expiresAt: number;
  info: MediaInfo | null;
  attribution?: StoredFileSummary["attribution"];
  /** Output produced from this source file id */
  sourceId?: string | null;
}

const filesRoot = () => path.join(config.dataDir, "files");
const jobsRoot = () => path.join(config.dataDir, "jobs");

export function newId() {
  return crypto.randomBytes(16).toString("hex");
}

/** Strip anything unsafe from a user-supplied filename; it is only ever used for display / Content-Disposition. */
export function sanitizeName(name: string, fallback = "video"): string {
  const base = name.replace(/[\\/]/g, "_").replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").trim();
  const clipped = base.slice(-140);
  return clipped || fallback;
}

export function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]{1,5})$/);
  return m ? m[1] : "";
}

function dirFor(id: string) {
  if (!ID_RE.test(id)) throw new HttpError(400, "Invalid file id");
  return path.join(filesRoot(), id);
}

export function mediaPath(meta: Pick<FileMeta, "id" | "ext">) {
  return path.join(dirFor(meta.id), `media.${meta.ext}`);
}

export async function ensureDirs() {
  await fsp.mkdir(filesRoot(), { recursive: true, mode: 0o700 });
  await fsp.mkdir(jobsRoot(), { recursive: true, mode: 0o700 });
}

/** Create the directory for a new stored file and return its target path. */
export async function allocateFile(ext: string) {
  await ensureDirs();
  const id = newId();
  const dir = path.join(filesRoot(), id);
  await fsp.mkdir(dir, { mode: 0o700 });
  return { id, dir, filePath: path.join(dir, `media.${ext}`) };
}

export async function writeMeta(meta: FileMeta) {
  await fsp.writeFile(path.join(dirFor(meta.id), "meta.json"), JSON.stringify(meta), { mode: 0o600 });
}

export async function readMeta(id: string): Promise<FileMeta | null> {
  try {
    const raw = await fsp.readFile(path.join(dirFor(id), "meta.json"), "utf8");
    return JSON.parse(raw) as FileMeta;
  } catch {
    return null;
  }
}

/** Load a file the session owns, or throw 404 (same response for foreign ids, so ids cannot be probed). */
export async function getOwnedFile(id: string, owner: string): Promise<FileMeta> {
  if (!ID_RE.test(id)) throw new HttpError(404, "File not found");
  const meta = await readMeta(id);
  if (!meta || meta.owner !== owner) throw new HttpError(404, "File not found");
  if (meta.expiresAt < Date.now()) {
    await deleteFile(id).catch(() => {});
    throw new HttpError(410, "This file has expired and was deleted from the server", "expired");
  }
  return meta;
}

export async function deleteFile(id: string) {
  await fsp.rm(dirFor(id), { recursive: true, force: true });
}

export function toSummary(meta: FileMeta): StoredFileSummary {
  return {
    id: meta.id,
    name: meta.name,
    size: meta.size,
    kind: meta.kind,
    createdAt: meta.createdAt,
    expiresAt: meta.expiresAt,
    mime: meta.mime,
    info: meta.info,
    attribution: meta.attribution ?? null,
  };
}

export async function makeJobDir(jobId: string) {
  await ensureDirs();
  const dir = path.join(jobsRoot(), jobId);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export async function removeJobDir(jobId: string) {
  if (!ID_RE.test(jobId)) return;
  await fsp.rm(path.join(jobsRoot(), jobId), { recursive: true, force: true });
}

/** Move a finished file from a job work dir into storage as a new stored file. */
export async function adoptFile(
  srcPath: string,
  init: Omit<FileMeta, "id" | "size" | "createdAt" | "expiresAt" | "mime"> & { ttlMs?: number },
): Promise<FileMeta> {
  const { id, filePath } = await allocateFile(init.ext);
  await fsp.rename(srcPath, filePath).catch(async () => {
    await fsp.copyFile(srcPath, filePath);
    await fsp.rm(srcPath, { force: true });
  });
  const stat = await fsp.stat(/*turbopackIgnore: true*/ filePath);
  const now = Date.now();
  const meta: FileMeta = {
    ...init,
    id,
    size: stat.size,
    mime: mimeFor(init.ext),
    createdAt: now,
    expiresAt: now + (init.ttlMs ?? config.fileTtlMs),
  };
  delete (meta as { ttlMs?: number }).ttlMs;
  await writeMeta(meta);
  return meta;
}

export async function listOwnedFiles(owner: string): Promise<FileMeta[]> {
  await ensureDirs();
  const out: FileMeta[] = [];
  for (const id of await fsp.readdir(filesRoot())) {
    if (!ID_RE.test(id)) continue;
    const m = await readMeta(id);
    if (m && m.owner === owner && m.expiresAt > Date.now()) out.push(m);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Delete expired stored files and stale job work directories. */
export async function cleanupExpired(activeJobIds: Set<string>) {
  await ensureDirs();
  const now = Date.now();
  for (const id of await fsp.readdir(filesRoot())) {
    const dir = path.join(filesRoot(), id);
    const meta = ID_RE.test(id) ? await readMeta(id) : null;
    if (!meta) {
      // orphan (e.g. aborted upload) — remove when older than 10 minutes
      const st = await fsp.stat(dir).catch(() => null);
      if (st && now - st.mtimeMs > 10 * 60_000) await fsp.rm(dir, { recursive: true, force: true });
      continue;
    }
    if (meta.expiresAt < now) await fsp.rm(dir, { recursive: true, force: true });
  }
  for (const id of await fsp.readdir(jobsRoot())) {
    if (activeJobIds.has(id)) continue;
    const dir = path.join(jobsRoot(), id);
    const st = await fsp.stat(dir).catch(() => null);
    if (st && now - st.mtimeMs > 15 * 60_000) await fsp.rm(dir, { recursive: true, force: true });
  }
}

export function createReadStream(p: string, opts?: { start?: number; end?: number }) {
  return fs.createReadStream(p, opts);
}
