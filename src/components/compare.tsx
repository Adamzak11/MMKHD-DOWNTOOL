"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Columns2, Maximize, Pause, Play, ScanEye, SquareSplitHorizontal, ZoomIn } from "lucide-react";
import { Button, Card, CardHeader, Segmented, cn } from "./ui";
import { frameUrl, mediaUrl } from "@/lib/api";
import { fmtDuration } from "@/lib/format";
import type { MediaInfo } from "@/lib/types";

function SyncedPlayers({ a, b, duration }: { a: string; b: string; duration: number }) {
  const ra = useRef<HTMLVideoElement>(null);
  const rb = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [err, setErr] = useState<{ a?: boolean; b?: boolean }>({});
  const [audioFrom, setAudioFrom] = useState<"a" | "b">("b");

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const va = ra.current, vb = rb.current;
      if (va && vb) {
        setT(va.currentTime);
        if (!va.paused && Math.abs(va.currentTime - vb.currentTime) > 0.06) vb.currentTime = va.currentTime;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toggle = async () => {
    const va = ra.current, vb = rb.current;
    if (!va || !vb) return;
    if (playing) {
      va.pause();
      vb.pause();
      vb.currentTime = va.currentTime;
      setPlaying(false);
    } else {
      vb.currentTime = va.currentTime;
      try {
        await Promise.all([va.play(), vb.play()]);
        setPlaying(true);
      } catch {
        setPlaying(false);
      }
    }
  };
  const seek = (v: number) => {
    if (ra.current) ra.current.currentTime = v;
    if (rb.current) rb.current.currentTime = v;
    setT(v);
  };

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2">
        {([["a", a, "Original"], ["b", b, "Compressed"]] as const).map(([k, src, label]) => (
          <div key={k} className="relative overflow-hidden rounded-xl border border-line bg-black">
            <video
              ref={k === "a" ? ra : rb}
              src={src}
              playsInline
              preload="auto"
              muted={audioFrom !== k}
              onEnded={() => setPlaying(false)}
              onError={() => setErr((e) => ({ ...e, [k]: true }))}
              className="aspect-video w-full object-contain"
            />
            <span className={cn("absolute left-2 top-2 rounded-md px-2 py-0.5 text-[11px] font-bold", k === "b" ? "bg-volt text-ink-950" : "bg-black/70 text-fg")}>{label}</span>
            {err[k] && (
              <div className="absolute inset-0 grid place-items-center bg-ink-900/95 p-4 text-center text-xs text-muted">
                This browser cannot decode this video&apos;s codec. Use the Frame inspector — frames are decoded on the server.
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="primary" size="sm" onClick={toggle} icon={playing ? <Pause className="size-4" /> : <Play className="size-4" />}>
          {playing ? "Pause both" : "Play both"}
        </Button>
        <input type="range" min={0} max={duration} step={0.01} value={t} onChange={(e) => seek(parseFloat(e.target.value))} className="min-w-40 flex-1" aria-label="Seek both videos" />
        <span className="num w-28 text-right text-xs text-muted">
          {fmtDuration(t)} / {fmtDuration(duration)}
        </span>
        <Segmented size="sm" value={audioFrom} onChange={setAudioFrom} options={[{ value: "a", label: "Audio: original" }, { value: "b", label: "Audio: compressed" }]} />
      </div>
    </div>
  );
}

function FrameInspector({ sourceId, outputId, duration, fps, srcSize }: { sourceId: string; outputId: string; duration: number; fps: number; srcSize: { w: number; h: number } }) {
  const [t, setT] = useState(Math.min(duration / 2, Math.max(0, duration - 0.1)));
  const [loadedT, setLoadedT] = useState(t);
  const [zoom, setZoom] = useState<"fit" | "100">("fit");
  const [view, setView] = useState<"split" | "side">("split");
  const [split, setSplit] = useState(50);
  const [loading, setLoading] = useState({ a: true, b: true });
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const sideA = useRef<HTMLDivElement>(null);
  const sideB = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setLoading({ a: true, b: true });
      setLoadedT(t);
    }, 250);
    return () => clearTimeout(id);
  }, [t]);

  const onMove = useCallback((clientX: number) => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = clientX - r.left + (zoom === "100" ? 0 : 0);
    setSplit(Math.max(0, Math.min(100, (x / r.width) * 100)));
  }, [zoom]);

  const step = 1 / (fps || 30);
  const imgA = frameUrl(sourceId, loadedT);
  const imgB = frameUrl(outputId, loadedT);
  const imgCls = zoom === "fit" ? "w-full h-auto" : "max-w-none";
  const imgStyle = zoom === "100" ? { width: srcSize.w, height: srcSize.h } : undefined;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented size="sm" value={view} onChange={setView} options={[{ value: "split", label: <span className="flex items-center gap-1"><SquareSplitHorizontal className="size-3.5" />Split</span> }, { value: "side", label: <span className="flex items-center gap-1"><Columns2 className="size-3.5" />Side by side</span> }]} />
        <Segmented size="sm" value={zoom} onChange={setZoom} options={[{ value: "fit", label: <span className="flex items-center gap-1"><Maximize className="size-3.5" />Fit</span> }, { value: "100", label: <span className="flex items-center gap-1"><ZoomIn className="size-3.5" />100%</span> }]} />
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="Previous frame" onClick={() => setT((x) => Math.max(0, x - step))} icon={<ChevronLeft className="size-4" />} />
          <span className="num w-24 text-center text-xs text-muted">{loadedT.toFixed(3)} s</span>
          <Button size="sm" variant="ghost" aria-label="Next frame" onClick={() => setT((x) => Math.min(duration - 0.05, x + step))} icon={<ChevronRight className="size-4" />} />
        </div>
      </div>
      <input type="range" min={0} max={Math.max(0, duration - 0.05)} step={step} value={t} onChange={(e) => setT(parseFloat(e.target.value))} className="mb-3 w-full" aria-label="Frame time" />

      {view === "split" ? (
        <div className={cn("scrollbar-thin relative overflow-auto rounded-xl border border-line bg-black", zoom === "100" && "max-h-[70vh]")}>
          <div
            ref={box}
            className="relative inline-block min-w-full cursor-ew-resize touch-none select-none align-top"
            onPointerDown={(e) => {
              dragging.current = true;
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              onMove(e.clientX);
            }}
            onPointerMove={(e) => dragging.current && onMove(e.clientX)}
            onPointerUp={() => (dragging.current = false)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imgA} alt="Original frame" className={cn("block", imgCls)} style={imgStyle} onLoad={() => setLoading((l) => ({ ...l, a: false }))} draggable={false} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imgB} alt="Compressed frame" className={cn("absolute left-0 top-0 block", imgCls)} style={{ ...imgStyle, clipPath: `inset(0 0 0 ${split}%)` }} onLoad={() => setLoading((l) => ({ ...l, b: false }))} draggable={false} />
            <div className="pointer-events-none absolute inset-y-0 w-px bg-volt" style={{ left: `${split}%` }}>
              <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-volt p-1.5 text-ink-950"><SquareSplitHorizontal className="size-3.5" /></div>
            </div>
            <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-[11px] font-bold">Original</span>
            <span className="pointer-events-none absolute right-2 top-2 rounded-md bg-volt px-2 py-0.5 text-[11px] font-bold text-ink-950">Compressed</span>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {([["Original", imgA, sideA, sideB], ["Compressed", imgB, sideB, sideA]] as const).map(([label, src, ref, other]) => (
            <div
              key={label}
              ref={ref}
              onScroll={(e) => {
                const o = other.current;
                if (o && (o.scrollLeft !== e.currentTarget.scrollLeft || o.scrollTop !== e.currentTarget.scrollTop)) {
                  o.scrollLeft = e.currentTarget.scrollLeft;
                  o.scrollTop = e.currentTarget.scrollTop;
                }
              }}
              className={cn("scrollbar-thin relative overflow-auto rounded-xl border border-line bg-black", zoom === "100" && "max-h-[60vh]")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`${label} frame`} className={cn("block", imgCls)} style={imgStyle} onLoad={() => setLoading((l) => ({ ...l, [label === "Original" ? "a" : "b"]: false }))} />
              <span className={cn("sticky bottom-2 left-2 ml-2 inline-block rounded-md px-2 py-0.5 text-[11px] font-bold", label === "Compressed" ? "bg-volt text-ink-950" : "bg-black/70")}>{label}</span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-faint">
        {loading.a || loading.b ? "Decoding frames on the server…" : `Exact frames decoded by FFmpeg as lossless PNG${zoom === "100" ? ` at ${srcSize.w}×${srcSize.h} (100%)` : ""}. Works for any codec, including HEVC/AV1.`}
      </p>
    </div>
  );
}

export function Comparison({ sourceId, outputId, sourceInfo, outputInfo }: { sourceId: string; outputId: string; sourceInfo: MediaInfo; outputInfo: MediaInfo }) {
  const [tab, setTab] = useState<"play" | "frame">("play");
  const v = sourceInfo.video!;
  return (
    <Card>
      <CardHeader
        icon={<ScanEye className="size-4" />}
        title="Before & after"
        subtitle="Synchronised playback, or exact frames at 100% zoom"
        right={<Segmented size="sm" value={tab} onChange={setTab} options={[{ value: "play", label: "Playback" }, { value: "frame", label: "Frame inspector" }]} />}
      />
      <div className="p-4 sm:p-5">
        {tab === "play" ? (
          <SyncedPlayers a={mediaUrl(sourceId)} b={mediaUrl(outputId)} duration={Math.min(sourceInfo.duration, outputInfo.duration)} />
        ) : (
          <FrameInspector sourceId={sourceId} outputId={outputId} duration={Math.min(sourceInfo.duration, outputInfo.duration)} fps={v.fps ?? 30} srcSize={{ w: v.width, h: v.height }} />
        )}
      </div>
    </Card>
  );
}
