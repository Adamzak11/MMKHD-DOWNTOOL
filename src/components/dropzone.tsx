"use client";
import { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { FileVideo, Upload, X } from "lucide-react";
import { Button, Progress, cn } from "./ui";
import { uploadFile, type UploadHandle } from "@/lib/api";
import { fmtBytes } from "@/lib/format";
import { useCapabilities } from "@/lib/hooks";
import type { StoredFileSummary } from "@/lib/types";

const ACCEPT = ".mp4,.m4v,.mov,.mkv,.webm,.avi,.flv,.wmv,.mpg,.mpeg,.ts,.mts,.m2ts,.3gp,.3g2,.ogv,.mxf,.asf,.vob,.y4m,.nut,video/*";

export function Dropzone({ onUploaded, compact = false, title = "Drop a video to start", inputId = "video-input" }: { onUploaded: (f: StoredFileSummary) => void; compact?: boolean; title?: string; inputId?: string }) {
  const caps = useCapabilities();
  const [drag, setDrag] = useState(false);
  const [state, setState] = useState<{ file: File; loaded: number; total: number; phase: "uploading" | "analyzing" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<UploadHandle | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const start = useCallback(
    async (file: File) => {
      setError(null);
      if (caps && file.size > caps.limits.maxUploadMB * 1e6) {
        setError(`${file.name} is ${fmtBytes(file.size)} — the limit is ${caps.limits.maxUploadMB} MB.`);
        return;
      }
      setState({ file, loaded: 0, total: file.size, phase: "uploading" });
      const h = uploadFile(file, (loaded, total) => setState((s) => s && { ...s, loaded, total, phase: loaded >= total ? "analyzing" : "uploading" }));
      handle.current = h;
      try {
        const res = await h.promise;
        setState(null);
        onUploaded(res);
      } catch (e) {
        setState(null);
        const msg = (e as Error).message;
        if (msg !== "Upload cancelled.") setError(msg);
      } finally {
        handle.current = null;
        if (input.current) input.current.value = "";
      }
    },
    [caps, onUploaded],
  );

  if (state) {
    const pct = state.total ? (state.loaded / state.total) * 100 : null;
    return (
      <div className={cn("rounded-[var(--radius-card)] border border-line bg-ink-800 p-5", !compact && "sm:p-8")}>
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-ink-700 text-volt"><FileVideo className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{state.file.name}</div>
            <div className="num text-xs text-muted">
              {state.phase === "uploading" ? `Uploading · ${fmtBytes(state.loaded)} of ${fmtBytes(state.total)} · ${pct?.toFixed(0)}%` : "Analyzing with FFprobe…"}
            </div>
          </div>
          {state.phase === "uploading" && (
            <Button variant="ghost" size="sm" icon={<X className="size-4" />} onClick={() => handle.current?.abort()}>
              Cancel
            </Button>
          )}
        </div>
        <Progress value={state.phase === "uploading" ? pct : null} className="mt-4" />
      </div>
    );
  }

  return (
    <div>
      <motion.label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void start(f);
        }}
        animate={{ scale: drag ? 1.01 : 1 }}
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[var(--radius-card)] border border-dashed text-center transition-colors",
          compact ? "px-5 py-8" : "px-6 py-14 sm:py-20",
          drag ? "border-volt bg-volt/[0.04]" : "border-ink-600 bg-ink-900 hover:border-volt/50 hover:bg-ink-800",
        )}
      >
        <div className={cn("grid place-items-center rounded-2xl border border-line bg-ink-800 text-volt transition-transform group-hover:-translate-y-0.5", compact ? "size-11" : "size-14")}>
          <Upload className={compact ? "size-5" : "size-6"} />
        </div>
        <div className={cn("font-semibold tracking-tight", compact ? "mt-3 text-[15px]" : "mt-5 text-lg")}>{title}</div>
        <div className="mt-1 text-[13px] text-muted">
          or <span className="text-volt underline-offset-4 group-hover:underline">browse files</span> · MP4, MOV, MKV, WebM and other FFmpeg formats
        </div>
        {caps && <div className="num mt-3 text-xs text-faint">Up to {caps.limits.maxUploadMB.toLocaleString()} MB · max {Math.round(caps.limits.maxDurationSec / 60)} min · streamed to the server, never held in browser memory</div>}
        <input
          ref={input}
          id={inputId}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void start(f);
          }}
        />
      </motion.label>
      {error && <div className="mt-3 rounded-xl border border-bad/30 bg-bad/5 px-4 py-3 text-[13px] text-bad">{error}</div>}
    </div>
  );
}
