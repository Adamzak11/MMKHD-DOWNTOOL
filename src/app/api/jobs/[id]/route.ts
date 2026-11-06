import { handler, json } from "@/server/http";
import { getSessionId } from "@/server/session";
import { cancelJob, getJob } from "@/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const owner = await getSessionId();
  return json(getJob((await params).id, owner));
});

/** Cancel a queued or running job (kills the FFmpeg process). */
export const DELETE = handler(async (_req: Request, { params }: Ctx) => {
  const owner = await getSessionId();
  return json(cancelJob((await params).id, owner));
});
