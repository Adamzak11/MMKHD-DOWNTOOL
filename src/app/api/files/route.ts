import { handler, json } from "@/server/http";
import { getSessionId } from "@/server/session";
import { listOwnedFiles, toSummary } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const owner = await getSessionId();
  return json((await listOwnedFiles(owner)).map(toSummary));
});
