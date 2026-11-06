import "server-only";
import { config } from "./config";
import { HttpError } from "./http";
import { CancelledError } from "./process";
import { cleanupExpired, makeJobDir, newId, removeJobDir, ID_RE } from "./storage";
import type { JobProgress, JobSummary } from "@/lib/types";

export class JobStop extends Error {
  /** Deliberate stop (impossible target / quality guard) — not a crash. */
  constructor(public explanation: string, public status: "rejected" | "failed" = "rejected") {
    super(explanation);
  }
}

export interface JobContext {
  id: string;
  signal: AbortSignal;
  workDir: string;
  job: JobSummary;
  progress(p: Partial<JobProgress>): void;
  log(level: JobSummary["log"][number]["level"], msg: string): void;
}

interface InternalJob {
  owner: string;
  summary: JobSummary;
  controller: AbortController;
  runner: (ctx: JobContext) => Promise<void>;
}

interface State {
  jobs: Map<string, InternalJob>;
  queue: string[];
  running: Set<string>;
  timer?: NodeJS.Timeout;
}

const g = globalThis as unknown as { __mkJobs?: State };
const state: State = (g.__mkJobs ??= { jobs: new Map<string, InternalJob>(), queue: [], running: new Set() });

function ensureJanitor() {
  if (state.timer) return;
  const tick = async () => {
    try {
      const active = new Set([...state.running, ...state.queue]);
      await cleanupExpired(active);
      const cutoff = Date.now() - config.fileTtlMs;
      for (const [id, j] of state.jobs) {
        if (!active.has(id) && (j.summary.finishedAt ?? j.summary.createdAt) < cutoff) state.jobs.delete(id);
      }
    } catch (err) {
      console.error("[mamatkilat] cleanup failed", err);
    }
  };
  state.timer = setInterval(tick, 5 * 60_000);
  state.timer.unref?.();
  void tick();
}

const emptyProgress = (): JobProgress => ({ phase: "queued", phaseLabel: "Waiting in queue", percent: null, attempt: null, maxAttempts: null, speed: null, etaSec: null });

export function createJob(owner: string, type: JobSummary["type"], title: string, runner: (ctx: JobContext) => Promise<void>, extra: Partial<JobSummary> = {}) {
  ensureJanitor();
  const pending = [...state.jobs.values()].filter((j) => j.owner === owner && (j.summary.status === "queued" || j.summary.status === "running")).length;
  if (pending >= config.maxQueuedPerSession) {
    throw new HttpError(429, `You already have ${pending} jobs queued or running. Wait for one to finish or cancel it.`, "too_many_jobs");
  }
  const id = newId();
  const summary: JobSummary = {
    id, type, status: "queued", title, createdAt: Date.now(), startedAt: null, finishedAt: null,
    progress: emptyProgress(), log: [], error: null, explanation: null, alternatives: [], queuePosition: null, ...extra,
  };
  state.jobs.set(id, { owner, summary, controller: new AbortController(), runner });
  state.queue.push(id);
  pump();
  return summary;
}

function pump() {
  while (state.running.size < config.maxConcurrentJobs && state.queue.length) {
    const id = state.queue.shift()!;
    const job = state.jobs.get(id);
    if (!job || job.summary.status !== "queued") continue;
    state.running.add(id);
    void execute(id, job).finally(() => {
      state.running.delete(id);
      pump();
    });
  }
}

async function execute(id: string, job: InternalJob) {
  const s = job.summary;
  s.status = "running";
  s.startedAt = Date.now();
  s.progress = { ...emptyProgress(), phase: "starting", phaseLabel: "Starting" };
  const timeout = setTimeout(() => job.controller.abort(new Error("timeout")), config.jobTimeoutMs);
  let workDir = "";
  try {
    workDir = await makeJobDir(id);
    const ctx: JobContext = {
      id,
      signal: job.controller.signal,
      workDir,
      job: s,
      progress: (p) => {
        s.progress = { ...s.progress, ...p };
      },
      log: (level, msg) => {
        s.log.push({ t: Date.now(), level, msg });
        if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
      },
    };
    await job.runner(ctx);
    if (s.status === "running") s.status = "done";
    s.progress = { ...s.progress, phase: "done", phaseLabel: "Complete", percent: 100, speed: null, etaSec: null };
  } catch (err) {
    const reason = job.controller.signal.reason as Error | undefined;
    if (reason?.message === "timeout") {
      s.status = "failed";
      s.error = `Processing time limit exceeded (${Math.round(config.jobTimeoutMs / 60000)} min).`;
    } else if (err instanceof CancelledError || job.controller.signal.aborted) {
      s.status = "cancelled";
      s.error = "Cancelled by user";
    } else if (err instanceof JobStop) {
      s.status = err.status;
      s.explanation = err.explanation;
    } else {
      s.status = "failed";
      s.error = (err as Error).message || "Processing failed";
      console.error(`[mamatkilat] job ${id} failed`, err);
    }
    s.progress = { ...s.progress, speed: null, etaSec: null };
    s.log.push({ t: Date.now(), level: s.status === "cancelled" ? "warn" : "error", msg: s.error ?? s.explanation ?? "Stopped" });
  } finally {
    clearTimeout(timeout);
    s.finishedAt = Date.now();
    if (workDir) await removeJobDir(id).catch(() => {});
  }
}

function withQueuePos(s: JobSummary): JobSummary {
  const pos = state.queue.indexOf(s.id);
  return { ...s, queuePosition: s.status === "queued" && pos >= 0 ? pos + 1 : null };
}

export function getJob(id: string, owner: string): JobSummary {
  if (!ID_RE.test(id)) throw new HttpError(404, "Job not found");
  const j = state.jobs.get(id);
  if (!j || j.owner !== owner) throw new HttpError(404, "Job not found");
  return withQueuePos(j.summary);
}

export function listJobs(owner: string): JobSummary[] {
  return [...state.jobs.values()]
    .filter((j) => j.owner === owner)
    .map((j) => withQueuePos(j.summary))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function cancelJob(id: string, owner: string): JobSummary {
  const s = getJob(id, owner);
  const j = state.jobs.get(id)!;
  if (s.status === "queued") {
    state.queue = state.queue.filter((q) => q !== id);
    j.summary.status = "cancelled";
    j.summary.error = "Cancelled before it started";
    j.summary.finishedAt = Date.now();
  } else if (s.status === "running") {
    j.controller.abort();
  }
  return withQueuePos(j.summary);
}

export function activeJobIds() {
  return new Set([...state.running, ...state.queue]);
}
