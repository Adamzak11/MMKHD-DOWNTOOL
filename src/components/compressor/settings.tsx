"use client";
import { Archive, Gauge, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";
import { Field, Segmented, Select, Toggle, cn } from "../ui";
import { DEFAULT_TARGET_MB, SIZE_PRESETS_MB, QUALITY_THRESHOLDS } from "@/lib/plan";
import type { Capabilities, CompressRequest, CompressionMode, MediaInfo, QualityPreference } from "@/lib/types";
import { useState } from "react";

const MODES: { id: CompressionMode; title: string; desc: string; icon: typeof Gauge; tag?: string }[] = [
  { id: "smart", title: "Smart Quality", desc: "Measures your content and spends bits only where needed. Under your target, quality first.", icon: Sparkles, tag: "Recommended" },
  { id: "strict", title: "Strict Under Target", desc: "Hits the size limit exactly with 2-pass encoding, verified and retried.", icon: Gauge },
  { id: "lossless", title: "Lossless", desc: "Bit-exact decoded frames. No size target — files are usually larger.", icon: Archive },
  { id: "custom", title: "Custom", desc: "Pick codec, size, max bitrate, resolution, FPS and audio yourself.", icon: SlidersHorizontal },
];

export const DEFAULT_REQUEST: Omit<CompressRequest, "fileId"> = {
  mode: "smart",
  qualityPreference: "balanced",
  targetSizeMB: DEFAULT_TARGET_MB,
  codec: "auto",
  audio: { mode: "auto", bitrateKbps: 128 },
  custom: { codec: "auto", targetSizeMB: DEFAULT_TARGET_MB, maxBitrateKbps: null, resolution: null, fps: null },
  lossless: { container: "auto" },
  qualityGuard: true,
  vmaf: false,
};

function SizePicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const isPreset = (SIZE_PRESETS_MB as readonly number[]).includes(value);
  const [custom, setCustom] = useState(!isPreset);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        value={custom ? "custom" : String(value)}
        onChange={(v) => {
          if (v === "custom") setCustom(true);
          else {
            setCustom(false);
            onChange(Number(v));
          }
        }}
        options={[...SIZE_PRESETS_MB.map((s) => ({ value: String(s), label: `${s} MB` })), { value: "custom", label: "Custom" }]}
      />
      {custom && (
        <div className="flex h-10 items-center gap-2 rounded-xl border border-line bg-ink-900 px-3">
          <input
            type="number"
            min={0.5}
            max={4000}
            step={0.1}
            value={value}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (Number.isFinite(n) && n >= 0.5) onChange(Math.min(4000, n));
            }}
            className="num w-20 bg-transparent text-sm outline-none"
            aria-label="Custom target size in MB"
          />
          <span className="text-xs text-faint">MB</span>
        </div>
      )}
    </div>
  );
}

export function CompressSettings({ req, setReq, caps, info }: { req: Omit<CompressRequest, "fileId">; setReq: (r: Omit<CompressRequest, "fileId">) => void; caps: Capabilities | null; info: MediaInfo }) {
  const set = (patch: Partial<CompressRequest>) => setReq({ ...req, ...patch });
  const setCustom = (patch: Partial<NonNullable<CompressRequest["custom"]>>) => setReq({ ...req, custom: { ...req.custom!, ...patch } });
  const v = info.video!;
  const short = Math.min(v.width, v.height);
  const codecOpts = [
    { value: "auto" as const, label: "Auto (recommended)" },
    { value: "h264" as const, label: "H.264 — max compatibility", disabled: caps ? !caps.encoders.h264 : false },
    { value: "h265" as const, label: "H.265 / HEVC — better efficiency", disabled: caps ? !caps.encoders.h265 : false },
    { value: "av1" as const, label: caps && !caps.encoders.av1 ? "AV1 — not available on this server" : "AV1 — best efficiency, slow", disabled: caps ? !caps.encoders.av1 : false },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-2.5 sm:grid-cols-2">
        {MODES.map((m) => {
          const active = req.mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => set({ mode: m.id })}
              className={cn(
                "group relative rounded-2xl border p-4 text-left transition-colors",
                active ? "border-volt/60 bg-volt/[0.05] glow" : "border-line bg-ink-900 hover:border-ink-600 hover:bg-ink-700/50",
              )}
              aria-pressed={active}
            >
              <div className="flex items-center gap-2.5">
                <m.icon className={cn("size-[18px]", active ? "text-volt" : "text-muted")} />
                <span className="text-sm font-bold">{m.title}</span>
                {m.tag && <span className="ml-auto rounded-md bg-volt px-1.5 py-0.5 text-[10px] font-bold text-ink-950">{m.tag}</span>}
              </div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{m.desc}</p>
            </button>
          );
        })}
      </div>

      {(req.mode === "smart" || req.mode === "strict") && (
        <Field label="Target file size" hint="1 MB = 1,000,000 bytes">
          <SizePicker value={req.targetSizeMB} onChange={(n) => set({ targetSizeMB: n })} />
        </Field>
      )}

      {req.mode === "custom" && (
        <div className="grid gap-5 rounded-2xl border border-line bg-ink-900 p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Target file size" hint="Off = quality-targeted (CRF)">
              <div className="flex flex-wrap items-center gap-3">
                <Toggle checked={req.custom!.targetSizeMB !== null} onChange={(on) => setCustom({ targetSizeMB: on ? DEFAULT_TARGET_MB : null })} label="" />
                {req.custom!.targetSizeMB !== null && <SizePicker value={req.custom!.targetSizeMB} onChange={(n) => setCustom({ targetSizeMB: n })} />}
              </div>
            </Field>
          </div>
          <Field label="Video codec">
            <Select value={req.custom!.codec} onChange={(c) => setCustom({ codec: c })} options={codecOpts} />
          </Field>
          <Field label="Maximum video bitrate" hint="average ≤ 10 Mbps always">
            <Select
              value={req.custom!.maxBitrateKbps ?? 0}
              onChange={(n) => setCustom({ maxBitrateKbps: n || null })}
              options={[{ value: 0, label: "No extra cap (10 Mbps)" }, ...[8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 600].map((k) => ({ value: k, label: `${k >= 1000 ? k / 1000 + " Mbps" : k + " kbps"}` }))]}
            />
          </Field>
          <Field label="Resolution" hint={`source ${v.width}×${v.height}`}>
            <Select
              value={req.custom!.resolution ?? 0}
              onChange={(n) => setCustom({ resolution: n || null })}
              options={[{ value: 0, label: `Keep source (${short}p)` }, ...[2160, 1440, 1080, 720, 540, 480, 360].filter((s) => s < short).map((s) => ({ value: s, label: `${s}p` }))]}
            />
          </Field>
          <Field label="Frame rate" hint={`source ${v.fps?.toFixed(2) ?? "?"} fps`}>
            <Select
              value={req.custom!.fps ?? 0}
              onChange={(n) => setCustom({ fps: n || null })}
              options={[{ value: 0, label: "Keep source FPS" }, ...[60, 50, 30, 25, 24, 15].filter((f) => v.fps && f < v.fps - 0.5).map((f) => ({ value: f, label: `${f} fps` }))]}
            />
          </Field>
        </div>
      )}

      {(req.mode === "smart" || req.mode === "strict") && (
        <Field label="Codec">
          <Select value={req.codec} onChange={(c) => set({ codec: c })} options={codecOpts} />
        </Field>
      )}

      {req.mode === "lossless" && (
        <Field label="Lossless container">
          <Segmented
            value={req.lossless!.container}
            onChange={(c) => set({ lossless: { container: c } })}
            options={[
              { value: "auto", label: "Auto" },
              { value: "mp4", label: "MP4 · H.264 QP 0" },
              { value: "mkv", label: "MKV · FFV1" },
            ]}
          />
        </Field>
      )}

      {req.mode !== "lossless" && (
        <Field label="Quality preference" hint="sets CRF and the Quality Guard threshold">
          <Segmented<QualityPreference>
            value={req.qualityPreference}
            onChange={(q) => set({ qualityPreference: q })}
            options={[
              { value: "high", label: "High" },
              { value: "balanced", label: "Balanced" },
              { value: "max", label: "Max compression" },
            ]}
          />
          <p className="mt-2 text-xs text-faint">{QUALITY_THRESHOLDS[req.qualityPreference].label}</p>
        </Field>
      )}

      <Field label="Audio" hint={info.audio ? undefined : "source has no audio"}>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={req.audio.mode}
            onChange={(m) => set({ audio: { ...req.audio, mode: m } })}
            options={[
              { value: "auto", label: "Auto", disabled: !info.audio },
              { value: "copy", label: "Keep original", disabled: !info.audio || req.mode === "lossless" },
              { value: "aac", label: "AAC", disabled: !info.audio || req.mode === "lossless" },
              { value: "remove", label: "Remove", disabled: !info.audio },
            ]}
          />
          {req.mode !== "lossless" && info.audio && (req.audio.mode === "aac" || req.audio.mode === "auto") && (
            <Select
              className="!w-auto"
              value={req.audio.bitrateKbps}
              onChange={(n) => set({ audio: { ...req.audio, bitrateKbps: n } })}
              options={[64, 96, 128, 160, 192, 256].map((k) => ({ value: k, label: `${k} kbps` }))}
            />
          )}
        </div>
        {req.audio.mode === "remove" && info.audio && <p className="mt-2 text-xs text-warn">Audio will be removed because you chose to. It is never removed automatically.</p>}
      </Field>

      {req.mode !== "lossless" && (
        <div className="space-y-4 rounded-2xl border border-line bg-ink-900 p-4">
          <div className="flex items-center gap-2 text-sm font-bold">
            <ShieldCheck className="size-4 text-volt" /> Quality Guard
          </div>
          <Toggle
            checked={req.qualityGuard}
            onChange={(b) => set({ qualityGuard: b })}
            label="Measure SSIM & PSNR against the source"
            description="Rejects results below the threshold instead of returning an over-compressed file."
          />
          <Toggle
            checked={req.vmaf && !!caps?.metrics.vmaf}
            onChange={(b) => set({ vmaf: b })}
            disabled={!caps?.metrics.vmaf || !req.qualityGuard}
            label="Also compute VMAF"
            description={caps?.metrics.vmaf ? "Perceptual metric (0–100). Slower." : "Unavailable — this server's FFmpeg build has no libvmaf."}
          />
        </div>
      )}
    </div>
  );
}
