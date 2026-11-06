"use client";
import { Calculator, Cpu, TriangleAlert, Wand2 } from "lucide-react";
import { Badge, Card, CardHeader, cn } from "../ui";
import { fmtBitrate, fmtBytes } from "@/lib/format";
import type { CompressionPlan, Feasibility, PlanAlternative } from "@/lib/types";

const FEAS: Record<Feasibility, { tone: "ok" | "volt" | "warn" | "bad"; label: string }> = {
  comfortable: { tone: "ok", label: "Comfortable" },
  good: { tone: "ok", label: "Good" },
  tight: { tone: "warn", label: "Tight" },
  "very-tight": { tone: "warn", label: "Very tight" },
  unrealistic: { tone: "bad", label: "Unrealistic" },
};

export function FeasibilityBadge({ f }: { f: Feasibility }) {
  return <Badge tone={FEAS[f].tone}>{FEAS[f].label}</Badge>;
}

export function Alternatives({ items, onApply }: { items: PlanAlternative[]; onApply: (a: PlanAlternative) => void }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="label-xs mb-2 flex items-center gap-1.5"><Wand2 className="size-3.5" /> Alternative settings</div>
      <div className="grid gap-2">
        {items.map((a) => (
          <button key={a.label} onClick={() => onApply(a)} className="group rounded-xl border border-line bg-ink-900 px-3.5 py-2.5 text-left transition-colors hover:border-volt/50">
            <div className="flex items-center justify-between gap-2 text-[13px] font-semibold">
              {a.label}
              <span className="text-[11px] font-semibold text-volt opacity-0 transition-opacity group-hover:opacity-100">Apply →</span>
            </div>
            <div className="mt-0.5 text-xs text-muted">{a.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function PlanPanel({ plan, onApply }: { plan: CompressionPlan; onApply: (a: PlanAlternative) => void }) {
  const b = plan.budget;
  const parts = b
    ? [
        { label: "Video", v: Math.max(0, b.videoBps), cls: "bg-volt" },
        { label: "Audio", v: b.audioBps, cls: "bg-white/70" },
        { label: "Container", v: b.overheadBps, cls: "bg-muted/60" },
        { label: "Safety", v: b.safetyBps, cls: "bg-ink-600" },
      ]
    : [];
  const total = parts.reduce((s, p) => s + p.v, 0) || 1;
  return (
    <Card>
      <CardHeader icon={<Calculator className="size-4" />} title="Bitrate calculator" subtitle="Computed from the real duration — the output is verified after encoding" right={plan.feasibility && <FeasibilityBadge f={plan.feasibility} />} />
      <div className="space-y-5 p-5">
        {b ? (
          <>
            <div>
              <div className="flex items-baseline justify-between">
                <span className="label-xs">Total budget</span>
                <span className="num text-xs text-faint">
                  ({fmtBytes(b.targetBytes)} × 8) ÷ {b.durationSec.toFixed(2)} s
                </span>
              </div>
              <div className="num mt-1 text-2xl font-bold tracking-tight">{fmtBitrate(b.totalBps)}</div>
              <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-ink-700">
                {parts.map((p) => (
                  <div key={p.label} className={p.cls} style={{ width: `${(p.v / total) * 100}%` }} title={`${p.label}: ${fmtBitrate(p.v)}`} />
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
                {parts.map((p) => (
                  <div key={p.label} className="flex items-center gap-2 text-xs">
                    <span className={cn("size-2 rounded-sm", p.cls)} />
                    <span className="text-muted">{p.label}</span>
                    <span className="num ml-auto whitespace-nowrap font-semibold md:ml-0">{fmtBitrate(p.v)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 rounded-xl border border-line bg-ink-900 p-3.5">
              <div>
                <div className="label-xs">Video bitrate</div>
                <div className="num mt-1 text-sm font-semibold text-volt">{fmtBitrate(Math.max(0, b.videoBps))}</div>
              </div>
              <div>
                <div className="label-xs">Output</div>
                <div className="num mt-1 text-sm font-semibold">
                  {b.outWidth}×{b.outHeight}
                </div>
              </div>
              <div>
                <div className="label-xs">Bits / pixel</div>
                <div className="num mt-1 text-sm font-semibold">{b.bitsPerPixel.toFixed(3)}</div>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">{plan.mode === "lossless" ? "Lossless mode has no size target — every decoded frame is preserved." : "No size target — the encoder targets constant quality (CRF), capped at a 10 Mbps average."}</p>
        )}
        {plan.feasibilityNote && <p className="text-[13px] leading-relaxed text-muted">{plan.feasibilityNote}</p>}

        <div className="space-y-2.5 border-t border-line pt-4 text-[13px]">
          <Row k="Codec" v={plan.codec === "copy" ? "Stream copy" : plan.codec === "ffv1" ? "FFV1" : plan.codec.toUpperCase()} note={plan.codecReason} icon={<Cpu className="size-3.5" />} />
          <Row k="Strategy" v={plan.strategy} />
          <Row k="Audio" v={plan.audioPlan} />
          <Row k="Pixels" v={plan.pixFmtPlan} />
          <Row k="Container" v={plan.container.toUpperCase()} />
        </div>

        {plan.warnings.length > 0 && (
          <ul className="space-y-1.5">
            {plan.warnings.map((w) => (
              <li key={w} className="flex gap-2 text-xs text-muted">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" /> {w}
              </li>
            ))}
          </ul>
        )}
        <Alternatives items={plan.alternatives} onApply={onApply} />
      </div>
    </Card>
  );
}

function Row({ k, v, note, icon }: { k: string; v: string; note?: string; icon?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_1fr] gap-3">
      <div className="label-xs pt-0.5">{k}</div>
      <div>
        <div className="flex items-center gap-1.5 font-medium">
          {icon}
          {v}
        </div>
        {note && <div className="mt-0.5 text-xs text-faint">{note}</div>}
      </div>
    </div>
  );
}
