import "server-only";
import crypto from "node:crypto";
import { config } from "./config";

/**
 * Short-lived signed upload tokens let a frontend on another domain (e.g. Netlify) send large files
 * straight to the processing server while ownership stays tied to the frontend session cookie.
 */
const TTL_MS = 15 * 60_000;

function mac(payload: string) {
  return crypto.createHmac("sha256", config.sessionSecret).update(`upload:${payload}`).digest("base64url");
}

export function createUploadToken(owner: string) {
  const payload = `${owner}.${Date.now() + TTL_MS}`;
  return `${payload}.${mac(payload)}`;
}

export function verifyUploadToken(token: string | null): string | null {
  if (!token || token.length > 200) return null;
  const [owner, exp, sig] = token.split(".");
  if (!owner || !exp || !sig || !/^[a-f0-9]{32}$/.test(owner) || !/^\d+$/.test(exp)) return null;
  if (Number(exp) < Date.now()) return null;
  const expected = mac(`${owner}.${exp}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return owner;
}

/** Origins allowed to upload directly (comma-separated FRONTEND_ORIGINS, e.g. https://mamat.netlify.app). */
export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = (process.env.FRONTEND_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "x-file-name, content-type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}
