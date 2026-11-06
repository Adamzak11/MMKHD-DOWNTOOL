"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { FileVideo, Repeat2, Rocket, Trash2 } from "lucide-react";
import { Dropzone } from "@/components/dropzone";
import { MediaInfoGrid } from "@/components/media-info";
import { CompressSettings, DEFAULT_REQUEST } from "@/components/compressor/settings";
import { PlanPanel } from "@/components/compressor/plan-panel";
import { ResultPanel } from "@/components/compressor/result-panel";
import { JobPanel } from "@/components/job-panel";
import { Comparison } from "@/components/compare";
import { Alert, Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui";
import { api, frameUrl, mediaUrl } from "@/lib/api";
import { buildPlan } from "@/lib/plan";
import { useCapabilities, useJob, TERMINAL } from "@/lib/hooks";
import { fmtBytes } from "@/lib/format";
import type { CompressRequest, PlanAlternative, StoredFileSummary } from "@/lib/types";

function SourcePreview({ file }: { file: StoredFileSummary }) {
  const [failed, setFailed] = useState(false);
  const d = file.info?.duration ?? 0;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-black">
      {!failed ? (
        <video src={mediaUrl(file.id)} controls playsInline preload="metadata" className="aspect-video w-full object-contain" onError={() => setFailed(true)} />
      ) : (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={frameUrl(file.id, d / 3)} alt="Frame preview" className="aspect-video w-full object-contain" />
          <div className="absolute inset-x-0 bottom-0 bg-black/75 px-3 py-2 text-xs text-muted">This browser can&apos;t play {file.info?.video?.codec?.toUpperCase()} — showing a server-decoded frame. Processing is unaffected.</div>
        </div>
      )}
    </div>
  );
}

function CompressorInner() {
  const router = useRouter();
  const params = useSearchParams();
  const caps = useCapabilities();
  const fileParam = params.get("file");
  const jobParam = params.get("job");
  const [file, setFile] = useState<StoredFileSummary | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [req, setReq] = useState<Omit<CompressRequest, "fileId">>(DEFAULT_REQUEST);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const { job, setJob, error: jobError } = useJob(jobParam);
  const compareRef = useRef<HTMLDivElement>(null);

  const setUrl = useCallback(
    (q: { file?: string | null; job?: string | null }) => {
      const sp = new URLSearchParams();
      if (q.file) sp.set("file", q.file);
      if (q.job) sp.set("job", q.job);
      router.replace(`/compress${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
    },
    [router],
  );

  // Load the source file (from ?file= or from the job's request)
  const sourceId = fileParam ?? job?.request?.fileId ?? null;
  useEffect(() => {
    if (!sourceId) {
      setFile(null);
      return;
    }
    if (file?.id === sourceId) return;
    setFileError(null);
    api.file(sourceId).then(setFile).catch((e) => setFileError(e.message));
  }, [sourceId, file?.id]);

  useEffect(() => {
    if (job?.request) {
      const { fileId: _f, ...rest } = job.request;
      void _f;
      setReq((r) => ({ ...r, ...rest, custom: rest.custom ?? r.custom, lossless: rest.lossless ?? r.lossless }));
    }
    // only when a job is first loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  const plan = useMemo(() => (file?.info?.video ? buildPlan({ ...req, fileId: file.id }, file.info, caps) : null), [req, file, caps]);
  const running = job && !TERMINAL.has(job.status);
  const finished = job && TERMINAL.has(job.status);

  const start = async () => {
    if (!file) return;
    setStarting(true);
    setStartError(null);
    setShowCompare(false);
    try {
      const j = await api.startJob({ ...req, fileId: file.id });
      setJob(j);
      setUrl({ file: file.id, job: j.id });
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const applyAlt = (a: PlanAlternative) => {
    setReq((r) => ({
      ...r,
      ...a.apply,
      audio: a.apply.audio ?? r.audio,
      custom: a.apply.custom ? { ...r.custom!, ...a.apply.custom } : r.custom,
      mode: a.apply.mode ?? (a.apply.custom && r.mode !== "custom" && !a.apply.targetSizeMB ? "custom" : r.mode),
    }));
    if (file) setUrl({ file: file.id });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const reset = () => {
    setShowCompare(false);
    if (file) setUrl({ file: file.id });
  };

  const removeFile = async () => {
    if (file && file.kind === "upload") await api.deleteFile(file.id).catch(() => {});
    setFile(null);
    setUrl({});
  };

  const compareIds = job?.compress ? { out: job.compress.outputFileId, src: job.compress.sourceFileId } : null;

  return (
    <div>
      <PageHeader
        eyebrow="Module A"
        title="Smart Video Compressor"
        description="Get under 10 MB while keeping the highest quality the bitrate allows. Every result is re-probed and size-checked before you can download it — nothing is estimated."
      />
      {fileError && <Alert tone="bad" title="Could not load the video" className="mb-4">{fileError}</Alert>}
      {jobError && <Alert tone="bad" title="Could not load the job" className="mb-4">{jobError}</Alert>}

      {!file && !sourceId && <Dropzone onUploaded={(f) => { setFile(f); setUrl({ file: f.id }); }} />}

      {file?.info && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
          <div className="min-w-0 space-y-5">
            <Card>
              <CardHeader
                icon={<FileVideo className="size-4" />}
                title={<span className="break-all">{file.name}</span>}
                subtitle={
                  <span className="flex flex-wrap items-center gap-2">
                    {fmtBytes(file.size)}
                    {file.kind === "retrieved" && <Badge tone="volt">From TikTok{file.attribution?.author ? ` · @${file.attribution.author}` : ""}</Badge>}
                  </span>
                }
                right={
                  !running && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" icon={<Repeat2 className="size-4" />} onClick={() => setReplacing((r) => !r)}>Replace</Button>
                      <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" />} onClick={removeFile} aria-label="Remove video">Remove</Button>
                    </div>
                  )
                }
              />
              <div className="space-y-5 p-5">
                {replacing && (
                  <Dropzone
                    compact
                    inputId="replace-input"
                    title="Drop a replacement video"
                    onUploaded={(f) => {
                      if (file.kind === "upload") void api.deleteFile(file.id).catch(() => {});
                      setReplacing(false);
                      setFile(f);
                      setJob(null);
                      setUrl({ file: f.id });
                    }}
                  />
                )}
                <SourcePreview file={file} />
                <MediaInfoGrid info={file.info} size={file.size} />
              </div>
            </Card>

            {plan && (!job || finished) && <PlanPanel plan={plan} onApply={applyAlt} />}
            <AnimatePresence mode="wait">
              {job && (
                <motion.div key={job.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">
                  <JobPanel job={job} onCancelled={setJob} />
                  {finished && (
                    <ResultPanel
                      job={job}
                      onApply={applyAlt}
                      onReset={reset}
                      onCompare={() => {
                        setShowCompare(true);
                        setTimeout(() => compareRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                      }}
                    />
                  )}
                  {job.status === "failed" && !job.explanation && <Alert tone="bad" title="Processing failed">{job.error}</Alert>}
                </motion.div>
              )}
            </AnimatePresence>
            <div ref={compareRef}>
              {showCompare && compareIds && job?.compress && (
                <Comparison sourceId={compareIds.src} outputId={compareIds.out} sourceInfo={job.compress.sourceInfo} outputInfo={job.compress.outputInfo} />
              )}
            </div>
          </div>

          <aside className="min-w-0 space-y-5">
            {(!job || finished) && (
              <Card>
                <CardHeader icon={<Rocket className="size-4" />} title="Compression settings" subtitle="Resolution and FPS are kept unless you change them" />
                <div className="p-5">
                  <CompressSettings req={req} setReq={setReq} caps={caps} info={file.info} />
                  {startError && <Alert tone="bad" className="mt-4">{startError}</Alert>}
                  <Button variant="primary" size="lg" className="mt-6 w-full" loading={starting} onClick={start} disabled={!plan || !!running}>
                    {finished ? "Compress again with these settings" : "Start compression"}
                  </Button>
                </div>
              </Card>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

export default function CompressPage() {
  return (
    <Suspense>
      <CompressorInner />
    </Suspense>
  );
}
