import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import { handler, HttpError } from "@/server/http";
import { getSessionId } from "@/server/session";
import { createReadStream, getOwnedFile, mediaPath } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Streams the stored file with HTTP Range support (video seeking) and optional attachment download. */
export const GET = handler(async (req: Request, { params }: Ctx) => {
  const owner = await getSessionId();
  const meta = await getOwnedFile((await params).id, owner);
  const p = mediaPath(meta);
  const { size } = await fsp.stat(p);
  const url = new URL(req.url);
  const download = url.searchParams.get("download") === "1";
  const headers: Record<string, string> = {
    "Content-Type": meta.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };
  if (download) {
    const ascii = meta.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    headers["Content-Disposition"] = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`;
  }
  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!m) throw new HttpError(416, "Invalid range");
    let start = m[1] ? parseInt(m[1], 10) : size - parseInt(m[2], 10);
    let end = m[1] && m[2] ? parseInt(m[2], 10) : size - 1;
    if (!m[1] && !m[2]) throw new HttpError(416, "Invalid range");
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const stream = createReadStream(p, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(createReadStream(p)) as ReadableStream, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
});
