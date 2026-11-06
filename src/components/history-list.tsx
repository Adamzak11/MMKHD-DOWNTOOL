"use client";
import Link from "next/link";
import { ArrowRight, Download, Gauge, Link2 } from "lucide-react";
import { StatusBadge } from "./job-panel";
import { mediaUrl } from "@/lib/api";
import { fmtBytes, fmtRelative } from "@/lib/format";
import type { JobSummary } from "@/lib/types";

export function HistoryList({ jobs, empty }: { jobs: JobSummary[]; empty?: React.ReactNode }) {
  if (!jobs.length) return <div className="px-5 py-10 text-center text-sm text-faint">{empty ?? "No processing yet."}</div>;
  return (
    <ul className="divide-y divide-line">
      {jobs.map((j) => {
        const href = j.type === "compress" ? `/compress?job=${j.id}` : j.retrieve ? `/compress?file=${j.retrieve.fileId}` : "/tiktok";
        const out = j.compress?.outputFileId && j.status === "done" ? j.compress : null;
        return (
          <li key={j.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5 sm:flex-nowrap">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-ink-700 text-volt">{j.type === "compress" ? <Gauge className="size-4" /> : <Link2 className="size-4" />}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{j.title}</div>
              <div className="num mt-0.5 text-xs text-faint">
                {fmtRelative(j.createdAt)}
                {j.status === "running" && j.progress.percent !== null && ` · ${j.progress.phaseLabel} ${j.progress.percent.toFixed(0)}%`}
                {out && ` · ${fmtBytes(out.sourceInfo.size)} → ${fmtBytes(out.outputInfo.size)}`}
              </div>
            </div>
            <StatusBadge status={j.status} />
            <div className="flex items-center gap-1">
              {out && (
                <a href={mediaUrl(out.outputFileId, true)} download className="grid size-9 place-items-center rounded-lg text-muted hover:bg-ink-700 hover:text-fg" aria-label="Download output">
                  <Download className="size-4" />
                </a>
              )}
              <Link href={href} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-ink-700 hover:text-fg" aria-label="Open">
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
