"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, Copy, Film, Gauge, Music, Package, RefreshCw } from "lucide-react";
import { Dropzone } from "@/components/dropzone";
import { Button, Card, CardHeader, PageHeader } from "@/components/ui";
import { reportSections, reportText } from "@/lib/report";
import type { StoredFileSummary } from "@/lib/types";

const ICONS = { Video: Film, Audio: Music, Container: Package };

export default function AnalyzePage() {
  const [file, setFile] = useState<StoredFileSummary | null>(null);
  const [copied, setCopied] = useState<"text" | "json" | null>(null);
  const copy = async (kind: "text" | "json") => {
    if (!file?.info) return;
    const text = kind === "text" ? reportText(file.info, file.name, file.size) : JSON.stringify({ name: file.name, fileSize: file.size, ...file.info }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(kind);
    setTimeout(() => setCopied(null), 1600);
  };
  return (
    <div>
      <PageHeader eyebrow="Module C" title="Video Analyzer" description="Inspect the real technical properties of any video, read directly by FFprobe on the server." />
      {!file && <Dropzone onUploaded={setFile} title="Drop a video to analyze" />}
      {file?.info && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={copied === "text" ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => copy("text")}>
              {copied === "text" ? "Copied" : "Copy report"}
            </Button>
            <Button icon={copied === "json" ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => copy("json")}>
              {copied === "json" ? "Copied" : "Copy JSON"}
            </Button>
            <Link href={`/compress?file=${file.id}`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-ink-700 px-4 text-sm font-semibold hover:bg-ink-600">
              <Gauge className="size-4" /> Compress this video
            </Link>
            <Button variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => setFile(null)}>Analyze another</Button>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {reportSections(file.info, file.name, file.size).map((s) => {
              const Icon = ICONS[s.title as keyof typeof ICONS];
              return (
                <Card key={s.title}>
                  <CardHeader icon={<Icon className="size-4" />} title={s.title} />
                  <dl className="divide-y divide-line px-5">
                    {s.rows.map(([k, v]) => (
                      <div key={k} className="grid grid-cols-[110px_1fr] gap-3 py-2.5 text-[13px]">
                        <dt className="text-muted">{k}</dt>
                        <dd className="num break-words font-medium">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
