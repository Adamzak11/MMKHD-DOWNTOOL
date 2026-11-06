"use client";
import { useEffect, useState } from "react";
import { History, HardDrive, Trash2 } from "lucide-react";
import { Card, CardHeader, PageHeader, Badge } from "@/components/ui";
import { HistoryList } from "@/components/history-list";
import { api, mediaUrl } from "@/lib/api";
import { fmtBytes, fmtRelative } from "@/lib/format";
import { useCapabilities } from "@/lib/hooks";
import type { JobSummary, StoredFileSummary } from "@/lib/types";

export default function HistoryPage() {
  const caps = useCapabilities();
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [files, setFiles] = useState<StoredFileSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    api.jobs().then(setJobs).catch((e) => setError(e.message));
    api.files().then(setFiles).catch(() => {});
  };
  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);
  return (
    <div>
      <PageHeader eyebrow="Module D" title="Processing History" description={`Jobs and files belong to this browser session only. Files are deleted from the server ${caps?.limits.fileTtlMin ?? 60} minutes after creation.`} />
      {error && <p className="mb-4 text-sm text-bad">{error}</p>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader icon={<History className="size-4" />} title="Jobs" subtitle={jobs ? `${jobs.length} in this session` : "Loading…"} />
          {jobs && <HistoryList jobs={jobs} />}
        </Card>
        <Card>
          <CardHeader icon={<HardDrive className="size-4" />} title="Workspace files" subtitle="Uploads, retrieved videos and outputs" />
          <ul className="divide-y divide-line">
            {files?.length === 0 && <li className="px-5 py-8 text-center text-sm text-faint">No files.</li>}
            {files?.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <a href={mediaUrl(f.id, true)} className="block truncate text-[13px] font-semibold hover:text-volt">{f.name}</a>
                  <div className="num text-xs text-faint">{fmtBytes(f.size)} · {fmtRelative(f.createdAt)} · expires {new Date(f.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                </div>
                <Badge tone={f.kind === "output" ? "volt" : "neutral"}>{f.kind}</Badge>
                <button aria-label="Delete file" className="grid size-8 place-items-center rounded-lg text-faint hover:bg-ink-700 hover:text-bad" onClick={async () => { await api.deleteFile(f.id).catch((e) => setError(e.message)); load(); }}>
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
