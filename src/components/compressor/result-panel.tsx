"use client";
import { Download, RefreshCw, ScanEye, ShieldAlert, ShieldCheck } from "lucide-react";
import { Alert, Badge, Button, ButtonLink, Card, CardHeader, cn } from "../ui";
import { Alternatives } from "./plan-panel";
import { mediaUrl } from "@/lib/api";
import { codecName, fmtBitrate, fmtBytes, fmtDuration, fmtFps } from "@/lib/format";
import type { CompressionResult, JobSummary, PlanAlternative, QualityMetrics } from "@/lib/types";

function MetricCard({ name, value, unit, scale, explain, pass }: { name: string; value: string; unit?: string; scale: string; explain: string; pass?: boolean | null }) {
  return (
    <div className="rounded-xl border border-line bg-ink-900 p-4">
      <div className="flex items-center justify-between">
        <span className="label-xs">{name}</span>
        {pass !== undefined && pass !== null && <Badge tone={pass ? "ok" : "warn"}>{pass ? "pass" : "below threshold"}</Badge>}
      </div>
      <div className="num mt-1.5 text-2xl font-bold tracking-tight">
        {value}
        {unit && <span className="ml-1 text-sm font-semibold text-muted">{unit}</span>}
      </div>
      <div className="mt-1 text-[11px] text-faint">{scale}</div>
      <p className="mt-2 text-xs leading-relaxed text-muted">{explain}</p>
    </div>
  );
}

export function QualityMetricsView({ m, threshold }: { m: QualityMetrics; threshold: CompressionResult["threshold"] }) {
  if (m.bitExact && m.ssim === null) {
    return <Alert tone="ok" title="No quality loss">{m.note}</Alert>;
  }
  if (m.bitExact) {
    return <Alert tone="ok" title="Lossless verified — bit-identical frames">MD5 hashes of every decoded frame match the source ({m.coverage}). SSIM = 1 and PSNR = ∞ by definition.</Alert>;
  }
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          name="SSIM (all planes)"
          value={m.ssim !== null ? m.ssim.toFixed(4) : "—"}
          scale={`scale 0–1 · ${m.ssimDb !== null && Number.isFinite(m.ssimDb) ? m.ssimDb.toFixed(2) + " dB" : ""}${threshold ? ` · gate ≥ ${threshold.ssim}` : ""}`}
          explain="Structural similarity of luma & chroma. Used as the Quality Guard gate."
          pass={threshold && m.ssim !== null ? m.ssim >= threshold.ssim : null}
        />
        <MetricCard name="PSNR (average)" value={m.psnr !== null ? (m.psnr >= 999 ? "∞" : m.psnr.toFixed(2)) : "—"} unit={m.psnr !== null && m.psnr < 999 ? "dB" : undefined} scale={`decibels · min ${m.psnrMin !== null && m.psnrMin < 999 ? m.psnrMin.toFixed(2) + " dB" : "—"}`} explain="Pixel-error ratio. ~40 dB+ is typically hard to tell apart; not comparable to SSIM." />
        <MetricCard name="VMAF" value={m.vmaf !== null ? m.vmaf.toFixed(1) : "n/a"} scale="scale 0–100" explain={m.vmaf !== null ? "Netflix perceptual model; ~93+ is usually indistinguishable at normal viewing." : "Not computed (disabled, or this FFmpeg build has no libvmaf)."} />
      </div>
      <p className="mt-3 text-xs text-faint">
        Measured on {m.coverage}. These are three different measurements on different scales — they are not percentages and are not converted into each other.{m.note ? ` ${m.note}` : ""}
      </p>
    </div>
  );
}

function CompareTable({ r }: { r: CompressionResult }) {
  const s = r.sourceInfo, o = r.outputInfo;
  const reduction = 100 - (o.size / s.size) * 100;
  const rows: [string, string, string][] = [
    ["File size", fmtBytes(s.size), fmtBytes(o.size)],
    ["Bitrate", fmtBitrate(s.bitrate), fmtBitrate(o.bitrate)],
    ["Resolution", s.video ? `${s.video.width}×${s.video.height}` : "—", o.video ? `${o.video.width}×${o.video.height}` : "—"],
    ["Frame rate", `${fmtFps(s.video?.fps)} fps`, `${fmtFps(o.video?.fps)} fps`],
    ["Video codec", codecName(s.video?.codec), codecName(o.video?.codec)],
    ["Pixel format", s.video?.pixFmt ?? "—", o.video?.pixFmt ?? "—"],
    ["Audio", s.audio ? `${codecName(s.audio.codec)} ${fmtBitrate(s.audio.bitrate)}` : "none", o.audio ? `${codecName(o.audio.codec)} ${fmtBitrate(o.audio.bitrate)}` : "none"],
    ["Duration", fmtDuration(s.duration), fmtDuration(o.duration)],
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <table className="w-full text-[13px]">
        <thead className="bg-ink-900 text-left">
          <tr>
            <th className="label-xs px-3.5 py-2.5 font-semibold"> </th>
            <th className="label-xs px-3.5 py-2.5 font-semibold">Original</th>
            <th className="label-xs px-3.5 py-2.5 font-semibold !text-volt">Output</th>
          </tr>
        </thead>
        <tbody className="num">
          {rows.map(([k, a, b]) => (
            <tr key={k} className="border-t border-line">
              <td className="px-3.5 py-2 text-muted">{k}</td>
              <td className="px-3.5 py-2">{a}</td>
              <td className={cn("px-3.5 py-2 font-semibold", a !== b && "text-fg")}>{b}</td>
            </tr>
          ))}
          <tr className="border-t border-line bg-ink-900">
            <td className="px-3.5 py-2 text-muted">Change</td>
            <td className="px-3.5 py-2" colSpan={2}>
              <span className={cn("font-bold", reduction >= 0 ? "text-volt" : "text-warn")}>{reduction >= 0 ? `${reduction.toFixed(1)}% smaller` : `${(-reduction).toFixed(1)}% larger`}</span>
              <span className="text-muted"> · {(s.size / Math.max(o.size, 1)).toFixed(1)}× ratio</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Attempts({ r }: { r: CompressionResult }) {
  if (r.attempts.length <= 1) return null;
  return (
    <details className="rounded-xl border border-line bg-ink-900 px-4 py-3 text-[13px]">
      <summary className="cursor-pointer font-semibold">Retry engine · {r.attempts.length} attempts</summary>
      <ol className="mt-3 space-y-2">
        {r.attempts.map((a) => (
          <li key={a.attempt} className="num grid gap-1 border-t border-line pt-2 text-xs sm:grid-cols-[28px_1fr_auto]">
            <span className="font-bold text-volt">#{a.attempt}</span>
            <span className="text-muted">
              {a.codec.toUpperCase()} · {a.strategy} → <span className="text-fg">{a.verdict}</span>
            </span>
            <span className="text-muted">
              {fmtBytes(a.sizeBytes)} {a.metrics?.ssim != null ? `· SSIM ${a.metrics.ssim.toFixed(4)}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function ResultPanel({ job, onCompare, onReset, onApply }: { job: JobSummary; onCompare: () => void; onReset: () => void; onApply: (a: PlanAlternative) => void }) {
  const r = job.compress;
  if (job.status === "rejected" || (job.status === "failed" && job.explanation)) {
    return (
      <Card>
        <CardHeader icon={<ShieldAlert className="size-4 !text-warn" />} title={job.status === "rejected" ? "Stopped to protect quality" : "Processing stopped"} subtitle="Nothing was silently downgraded" />
        <div className="space-y-5 p-5">
          <Alert tone="warn" title="Why">{job.explanation}</Alert>
          {r?.metrics && <QualityMetricsView m={r.metrics} threshold={r.threshold} />}
          <Alternatives items={job.alternatives} onApply={onApply} />
          <div className="flex flex-wrap gap-2">
            {job.rejectedOutput && (
              <ButtonLink href={mediaUrl(job.rejectedOutput.fileId, true)} download icon={<Download className="size-4" />}>
                Download below-threshold result anyway ({fmtBytes(job.rejectedOutput.size)})
              </ButtonLink>
            )}
            {job.rejectedOutput && <Button onClick={onCompare} icon={<ScanEye className="size-4" />}>Inspect it</Button>}
            <Button variant="ghost" onClick={onReset} icon={<RefreshCw className="size-4" />}>Change settings</Button>
          </div>
        </div>
      </Card>
    );
  }
  if (job.status !== "done" || !r) return null;
  const o = r.outputInfo;
  return (
    <Card className="glow-soft">
      <CardHeader
        icon={r.qualityPassed === false ? <ShieldAlert className="size-4" /> : <ShieldCheck className="size-4" />}
        title="Compression complete — output verified"
        subtitle={r.targetBytes ? `Under ${fmtBytes(r.targetBytes)} target · probed with FFprobe before download` : "Probed with FFprobe before download"}
        right={r.meetsTarget !== null && <Badge tone={r.meetsTarget ? "ok" : "bad"}>{r.meetsTarget ? "Meets target" : "Over target"}</Badge>}
      />
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Big label="Final size" value={fmtBytes(o.size, 3)} accent />
          <Big label="Bitrate" value={fmtBitrate(o.bitrate)} />
          <Big label="Reduction" value={`${Math.max(0, 100 - (o.size / r.sourceInfo.size) * 100).toFixed(1)}%`} />
          <Big label="Codec" value={codecName(o.video?.codec)} />
          <Big label="Resolution" value={o.video ? `${o.video.width}×${o.video.height}` : "—"} />
          <Big label="Frame rate" value={`${fmtFps(o.video?.fps)} fps`} />
          <Big label="Duration" value={fmtDuration(o.duration)} />
          <Big label="Audio" value={o.audio ? `${codecName(o.audio.codec)}` : "None"} />
        </div>
        {r.metrics && <QualityMetricsView m={r.metrics} threshold={r.threshold} />}
        {!r.metrics && job.request?.qualityGuard === false && <Alert>Quality Guard was turned off, so no quality metrics were measured.</Alert>}
        <CompareTable r={r} />
        <Attempts r={r} />
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={mediaUrl(r.outputFileId, true)} download variant="primary" icon={<Download className="size-4" />}>
            Download {r.plan.container.toUpperCase()}
          </ButtonLink>
          <Button onClick={onCompare} icon={<ScanEye className="size-4" />}>Compare videos</Button>
          <Button variant="ghost" onClick={onReset} icon={<RefreshCw className="size-4" />}>Compress another video</Button>
        </div>
      </div>
    </Card>
  );
}

function Big({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="label-xs">{label}</div>
      <div className={cn("num mt-1 truncate text-lg font-bold tracking-tight", accent && "text-volt")}>{value}</div>
    </div>
  );
}
