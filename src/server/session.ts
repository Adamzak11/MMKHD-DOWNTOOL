import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { config } from "./config";

const COOKIE = "mk_sid";
const ID_RE = /^[a-f0-9]{32}$/;

function sign(id: string): string {
  return crypto.createHmac("sha256", config.sessionSecret).update(id).digest("hex").slice(0, 32);
}

function verify(value: string | undefined): string | null {
  if (!value) return null;
  const [id, sig] = value.split(".");
  if (!id || !sig || !ID_RE.test(id)) return null;
  const expected = sign(id);
  if (sig.length !== expected.length) return null;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? id : null;
}

/**
 * Returns the anonymous session id that owns uploads and jobs.
 * Creates (and sets) a signed, httpOnly cookie when missing.
 * Only call from Route Handlers (cookies can be written there).
 */
export async function getSessionId(): Promise<string> {
  const jar = await cookies();
  const existing = verify(jar.get(COOKIE)?.value);
  if (existing) return existing;
  const id = crypto.randomBytes(16).toString("hex");
  jar.set(COOKIE, `${id}.${sign(id)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return id;
}
