import { handler, HttpError, json, readJson } from "@/server/http";
import { compressRequestSchema } from "@/server/schemas";
import { getSessionId } from "@/server/session";
import { rateLimit } from "@/server/ratelimit";
import { getOwnedFile } from "@/server/storage";
import { createJob, listJobs } from "@/server/jobs";
import { runCompression } from "@/server/compressor/engine";
import type { CompressRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODE_LABEL = { lossless: "Lossless", smart: "Smart Quality", strict: "Strict size", custom: "Custom" } as const;

export const GET = handler(async () => {
  const owner = await getSessionId();
  return json(listJobs(owner));
});

export const POST = handler(async (req: Request) => {
  const owner = await getSessionId();
  rateLimit(`jobs:${owner}`, 6, 12);
  const body = compressRequestSchema.parse(await readJson(req)) as CompressRequest;
  const src = await getOwnedFile(body.fileId, owner);
  if (!src.info?.video) throw new HttpError(422, "This file has no video stream to compress.");
  const target = body.mode === "custom" ? body.custom?.targetSizeMB : body.mode === "lossless" ? null : body.targetSizeMB;
  const title = `${MODE_LABEL[body.mode]}${target ? ` · ${target} MB` : ""} — ${src.name}`;
  const job = createJob(owner, "compress", title, (ctx) => runCompression(ctx, body, src), { request: body });
  return json(job, { status: 202 });
});
