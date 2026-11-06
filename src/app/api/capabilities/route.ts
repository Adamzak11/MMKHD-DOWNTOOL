import { getCapabilities } from "@/server/capabilities";
import { handler, json } from "@/server/http";
import { getSessionId } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  await getSessionId();
  return json(await getCapabilities());
});
