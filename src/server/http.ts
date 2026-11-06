import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error") {
    super(message);
  }
}

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers || {}) } });
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof ZodError) {
    const msg = err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return json({ error: `Invalid request — ${msg}`, code: "invalid_request" }, { status: 400 });
  }
  console.error("[mamatkilat] unhandled error", err);
  return json({ error: "Internal server error", code: "internal" }, { status: 500 });
}

/** Wrap a route handler so thrown HttpErrors become JSON responses. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson(req: Request, maxBytes = 64_000): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request body too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Body must be valid JSON");
  }
}
