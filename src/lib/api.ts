"use client";
import type { Capabilities, CompressRequest, CompressionPlan, JobSummary, StoredFileSummary, TikTokResolveResult } from "./types";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) }, credentials: "same-origin" });
  } catch {
    throw new ApiError("Network error — could not reach the server.", 0, "network");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error || `Request failed (HTTP ${res.status})`, res.status, data?.code);
  return data as T;
}

export const api = {
  capabilities: () => call<Capabilities>("/api/capabilities"),
  file: (id: string) => call<StoredFileSummary>(`/api/files/${id}`),
  files: () => call<StoredFileSummary[]>("/api/files"),
  deleteFile: (id: string) => call<{ ok: true }>(`/api/files/${id}`, { method: "DELETE" }),
  plan: (req: CompressRequest, signal?: AbortSignal) => call<CompressionPlan>("/api/plan", { method: "POST", body: JSON.stringify(req), signal }),
  startJob: (req: CompressRequest) => call<JobSummary>("/api/jobs", { method: "POST", body: JSON.stringify(req) }),
  job: (id: string) => call<JobSummary>(`/api/jobs/${id}`),
  jobs: () => call<JobSummary[]>("/api/jobs"),
  cancelJob: (id: string) => call<JobSummary>(`/api/jobs/${id}`, { method: "DELETE" }),
  tiktokResolve: (url: string) => call<TikTokResolveResult>("/api/tiktok/resolve", { method: "POST", body: JSON.stringify({ url }) }),
  tiktokRetrieve: (body: { url: string; formatId: string; rightsConfirmed: true; ownerConfirmed: boolean }) =>
    call<JobSummary>("/api/tiktok/retrieve", { method: "POST", body: JSON.stringify(body) }),
};

export const mediaUrl = (id: string, download = false) => `/api/files/${id}/media${download ? "?download=1" : ""}`;
export const frameUrl = (id: string, t: number) => `/api/files/${id}/frame?t=${t.toFixed(3)}`;

export interface UploadHandle {
  promise: Promise<StoredFileSummary>;
  abort: () => void;
}

/** Streams the File to the server (the browser never reads it into memory) with real progress events. */
export function uploadFile(file: File, onProgress: (loaded: number, total: number) => void): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<StoredFileSummary>((resolve, reject) => {
    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress(e.loaded, e.lengthComputable ? e.total : file.size);
    xhr.onload = () => {
      let data: { error?: string; code?: string } | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as unknown as StoredFileSummary);
      else reject(new ApiError(data?.error || `Upload failed (HTTP ${xhr.status})`, xhr.status, data?.code));
    };
    xhr.onerror = () => reject(new ApiError("Network error during upload.", 0, "network"));
    xhr.onabort = () => reject(new ApiError("Upload cancelled.", 0, "aborted"));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
