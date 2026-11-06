import { handler, json } from "@/server/http";
import { getSessionId } from "@/server/session";
import { deleteFile, getOwnedFile, toSummary } from "@/server/storage";
import { activeJobIds, listJobs } from "@/server/jobs";
import { HttpError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const owner = await getSessionId();
  const meta = await getOwnedFile((await params).id, owner);
  return json(toSummary(meta));
});

export const DELETE = handler(async (_req: Request, { params }: Ctx) => {
  const owner = await getSessionId();
  const { id } = await params;
  await getOwnedFile(id, owner);
  const active = activeJobIds();
  const busy = listJobs(owner).some((j) => active.has(j.id) && j.request?.fileId === id);
  if (busy) throw new HttpError(409, "This file is being processed. Cancel the job first.", "busy");
  await deleteFile(id);
  return json({ ok: true });
});
