"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Gauge, History, Link2, ScanSearch, ShieldCheck } from "lucide-react";
import { Dropzone } from "@/components/dropzone";
import { HistoryList } from "@/components/history-list";
import { Card, CardHeader } from "@/components/ui";
import { api } from "@/lib/api";
import type { JobSummary } from "@/lib/types";

const MODULES = [
  { href: "/compress", icon: Gauge, title: "Smart Video Compressor", body: "Under 10 MB with the best quality the bitrate allows. 2-pass encoding, size-verified retries, Quality Guard.", tag: "A" },
  { href: "/tiktok", icon: Link2, title: "TikTok HD Downloader", body: "Retrieve videos you own or may reuse in their genuine source quality, then compress in one click.", tag: "B" },
  { href: "/analyze", icon: ScanSearch, title: "Video Analyzer", body: "Resolution, FPS, codecs, bitrates, pixel format and audio — read by FFprobe, copy as a report.", tag: "C" },
];

export default function Dashboard() {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  useEffect(() => {
    const load = () => api.jobs().then(setJobs).catch(() => setJobs([]));
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, []);
  const active = jobs?.filter((j) => j.status === "running" || j.status === "queued").length ?? 0;

  return (
    <div className="space-y-6">
      <section className="grid-bg relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-ink-900 px-5 py-8 sm:px-8 sm:py-10">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-volt/10 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_420px] lg:items-center">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
            <div className="label-xs !text-volt">MAMATKILAT VIDEO TOOLS</div>
            <h1 className="mt-3 text-[30px] font-black leading-[1.08] tracking-tight sm:text-[42px]">
              Compress videos intelligently.
              <br />
              <span className="text-muted">Preserve quality.</span>
            </h1>
            <p className="mt-4 max-w-lg text-[15px] text-muted">Download and process videos in one place. Real FFmpeg encoding, measured quality, verified output — no estimates presented as results.</p>
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted">
              <span className="flex items-center gap-2"><ShieldCheck className="size-4 text-volt" /> SSIM / PSNR Quality Guard</span>
              <span className="flex items-center gap-2"><Gauge className="size-4 text-volt" /> H.264 · H.265 · AV1</span>
            </div>
          </motion.div>
          <Dropzone compact title="Drop a video to compress" inputId="dash-input" onUploaded={(f) => router.push(`/compress?file=${f.id}`)} />
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        {MODULES.map((m, i) => (
          <motion.div key={m.href} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i + 0.1 }}>
            <Link href={m.href} className="group flex h-full flex-col rounded-[var(--radius-card)] border border-line bg-ink-800 p-5 transition-colors hover:border-volt/40">
              <div className="flex items-center justify-between">
                <div className="grid size-10 place-items-center rounded-xl bg-ink-700 text-volt"><m.icon className="size-5" /></div>
                <span className="num text-xs font-bold text-faint">{m.tag}</span>
              </div>
              <h2 className="mt-4 text-[15px] font-bold">{m.title}</h2>
              <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-muted">{m.body}</p>
              <span className="mt-4 flex items-center gap-1.5 text-[13px] font-semibold text-volt">
                Open <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          </motion.div>
        ))}
      </div>

      <Card>
        <CardHeader
          icon={<History className="size-4" />}
          title="Recent processing"
          subtitle={active ? `${active} job${active > 1 ? "s" : ""} in progress` : "Your latest jobs in this session"}
          right={<Link href="/history" className="text-[13px] font-semibold text-muted hover:text-fg">View all</Link>}
        />
        {jobs === null ? <div className="px-5 py-10 text-center text-sm text-faint">Loading…</div> : <HistoryList jobs={jobs.slice(0, 5)} empty="No processing yet — upload a video or paste a TikTok link to begin." />}
      </Card>
    </div>
  );
}
