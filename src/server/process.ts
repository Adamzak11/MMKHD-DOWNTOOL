import "server-only";
import { spawn } from "node:child_process";
import { config } from "./config";

export class ProcessError extends Error {
  constructor(message: string, public exitCode: number | null, public stderrTail: string) {
    super(message);
  }
}

export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
  }
}

export interface RunOptions {
  signal?: AbortSignal;
  /** Called with stdout chunks split into lines */
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  timeoutMs?: number;
  /** Keep this many characters of stderr for error reporting / parsing */
  stderrLimit?: number;
  collectStdout?: boolean;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

/**
 * Run a binary with an argument array (never through a shell), with
 * cancellation, timeout and line-oriented output callbacks.
 */
export function run(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new CancelledError());
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const limit = opts.stderrLimit ?? 64_000;
    let stderr = "";
    let stdout = "";
    let outBuf = "";
    let errBuf = "";
    let killedFor: "cancel" | "timeout" | null = null;

    const kill = (why: "cancel" | "timeout") => {
      if (killedFor) return;
      killedFor = why;
      child.kill("SIGKILL");
    };
    const onAbort = () => kill("cancel");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => kill("timeout"), opts.timeoutMs ?? config.jobTimeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      if (opts.collectStdout) stdout += d;
      if (opts.onStdoutLine) {
        outBuf += d;
        let i;
        while ((i = outBuf.search(/[\r\n]/)) >= 0) {
          const line = outBuf.slice(0, i);
          outBuf = outBuf.slice(i + 1);
          if (line) opts.onStdoutLine(line);
        }
      }
    });
    child.stderr.on("data", (d: string) => {
      stderr += d;
      if (stderr.length > limit * 2) stderr = stderr.slice(-limit);
      if (opts.onStderrLine) {
        errBuf += d;
        let i;
        while ((i = errBuf.search(/[\r\n]/)) >= 0) {
          const line = errBuf.slice(0, i);
          errBuf = errBuf.slice(i + 1);
          if (line) opts.onStderrLine(line);
        }
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      reject(new ProcessError(`Failed to start ${bin}: ${err.message}`, null, ""));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (killedFor === "cancel") return reject(new CancelledError());
      if (killedFor === "timeout") return reject(new ProcessError("Processing time limit exceeded", code, stderr.slice(-limit)));
      if (code !== 0) {
        const tail = stderr.trim().split("\n").slice(-6).join("\n");
        return reject(new ProcessError(`${bin.split("/").pop()} exited with code ${code}: ${tail}`, code, stderr.slice(-limit)));
      }
      resolve({ stdout, stderr: stderr.slice(-limit) });
    });
  });
}

export interface FfmpegProgress {
  outTimeSec: number;
  speed: number | null;
  fps: number | null;
}

/**
 * Run ffmpeg with `-progress pipe:1` and report progress as fraction of
 * `durationSec`. Progress values come from FFmpeg itself, not timers.
 */
export function runFfmpeg(
  args: string[],
  opts: RunOptions & { durationSec?: number; onProgress?: (p: FfmpegProgress & { fraction: number | null }) => void } = {},
) {
  const full = ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-stats_period", "0.5", ...args];
  let cur: Partial<FfmpegProgress> = {};
  return run(config.ffmpeg, full, {
    ...opts,
    onStdoutLine: (line) => {
      const eq = line.indexOf("=");
      if (eq < 0) return;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (k === "out_time_us" || k === "out_time_ms") {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) cur.outTimeSec = n / 1e6; // both are microseconds in practice
      } else if (k === "speed") {
        const n = parseFloat(v);
        cur.speed = Number.isFinite(n) ? n : null;
      } else if (k === "fps") {
        const n = parseFloat(v);
        cur.fps = Number.isFinite(n) ? n : null;
      } else if (k === "progress") {
        const t = cur.outTimeSec ?? 0;
        const d = opts.durationSec;
        opts.onProgress?.({
          outTimeSec: t,
          speed: cur.speed ?? null,
          fps: cur.fps ?? null,
          fraction: d && d > 0 ? Math.max(0, Math.min(1, v === "end" ? 1 : t / d)) : null,
        });
        cur = { ...cur };
      }
    },
  });
}
