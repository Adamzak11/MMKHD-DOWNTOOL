import { buildPlan } from "@/lib/plan";
import { getCapabilities } from "@/server/capabilities";
import { handler, json, readJson } from "@/server/http";
import { compressRequestSchema } from "@/server/schemas";
import { getSessionId } from "@/server/session";
import { getOwnedFile } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dry-run: returns the bitrate budget, codec recommendation and feasibility without encoding. */
export const POST = handler(async (req: Request) => {
  const owner = await getSessionId();
  const body = compressRequestSchema.parse(await readJson(req));
  const meta = await getOwnedFile(body.fileId, owner);
  if (!meta.info) return json({ error: "File has no analysis" }, { status: 422 });
  return json(buildPlan(body, meta.info, await getCapabilities()));
});
