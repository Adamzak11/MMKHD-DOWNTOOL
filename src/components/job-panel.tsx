"use client";
import { useState } from "react";
import { Ban, CircleAlert, CircleCheck, LoaderCircle, Terminal } from "lucide-react";
import { Badge, Button, Card, Progress, cn } from "./ui";
import { api } from "@/lib/api";
import { fmtEta } from "@/lib/format";
import type { JobSummary } from "@/lib/types";

export function StatusBadge({ status }: { status: JobSummary["status"] }) {
  const map = {
    queued: { tone: "neutral", label: "Queued" },
    running: { tone: "volt", label: "Processing" },
    done: { tone: "ok", label: "Complete" },
    failed: { tone: "bad", label: "Failed" },
    cancelled: { tone: "neutral", label: "Cancelled" },
    rejected: { tone: "warn", label: "Stopped by Quality Guard" },
  } as const;
  const m = map[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function JobPanel({ job, onCancelled }: { job: JobSummary; onCancelled?: (j: JobSummary) => void }) {
  const [cancelling, setCancelling] = useState(false);
  const [showLog, setShowLog] = useState(true);
  const active = job.status === "queued" || job.status === "running";
  const p = job.progress;
  return (
    <Card className={cn(active && "glow-soft")}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-8 place-items-center rounded-lg bg-ink-700">
            {active ? <LoaderCircle className="size-4 animate-spin text-volt" /> : job.status === "done" ? <CircleCheck className="size-4 text-ok" /> : <CircleAlert className="size-4 text-warn" />}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">{job.title}</div>
            <div className="text-xs text-faint">Job {job.id.slice(0, 8)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={job.status} />
          {active && (
            <Button
              variant="danger"
              size="sm"
              loading={cancelling}
              icon={<Ban className="size-3.5" />}
              onClick={async () => {
                setCancelling(true);
                try {
                  const j = await api.cancelJob(job.id);
                  onCancelled?.(j);
                } finally {
                  setCancelling(false);
                }
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>
      {active && (
        <div className="space-y-3 px-5 py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-sm font-semibold">{job.status === "queued" ? `Waiting in queue${job.queuePosition ? ` · position ${job.queuePosition}` : ""}` : p.phaseLabel}</div>
            <div className="num flex items-center gap-3 text-xs text-muted">
              {p.attempt && p.maxAttempts && <span>attempt {p.attempt}/{p.maxAttempts}</span>}
              {p.speed && <span>{p.speed}</span>}
              {p.etaSec !== null && p.etaSec !== undefined && <span>ETA {fmtEta(p.etaSec)}</span>}
              {p.percent !== null && <span className="font-semibold text-fg">{p.percent.toFixed(1)}%</span>}
            </div>
          </div>
          <Progress value={job.status === "queued" ? null : p.percent} />
          <p className="text-xs text-faint">Progress is reported by FFmpeg for the current step. Retries and quality checks are separate steps.</p>
        </div>
      )}
      {job.log.length > 0 && (
        <div className="border-t border-line">
          <button onClick={() => setShowLog((s) => !s)} className="flex w-full items-center gap-2 px-5 py-3 text-xs font-semibold text-muted hover:text-fg">
            <Terminal className="size-3.5" /> Processing log ({job.log.length}) {showLog ? "▾" : "▸"}
          </button>
          {showLog && (
            <ol className="scrollbar-thin max-h-64 space-y-1 overflow-y-auto px-5 pb-4 font-mono text-[11.5px] leading-relaxed">
              {job.log.map((l, i) => (
                <li key={i} className={cn(l.level === "error" ? "text-bad" : l.level === "warn" ? "text-warn" : l.level === "success" ? "text-ok" : "text-muted")}>
                  <span className="text-faint">{new Date(l.t).toLocaleTimeString()} </span>
                  {l.msg}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Card>
  );
}
