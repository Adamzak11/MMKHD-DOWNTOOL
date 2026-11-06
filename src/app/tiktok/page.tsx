"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { CircleCheck, Download, Gauge, Link2, ScanSearch, ShieldCheck, X } from "lucide-react";
import { Alert, Badge, Button, ButtonLink, Card, CardHeader, PageHeader, cn } from "@/components/ui";
import { JobPanel } from "@/components/job-panel";
import { MediaInfoGrid } from "@/components/media-info";
import { api, mediaUrl } from "@/lib/api";
import { parseTikTokUrl } from "@/lib/tiktok-url";
import { useCapabilities, useJob } from "@/lib/hooks";
import { fmtBytes, fmtDuration } from "@/lib/format";
import type { TikTokResolveResult } from "@/lib/types";

export default function TikTokPage() {
  const caps = useCapabilities();
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TikTokResolveResult | null>(null);
  const [formatId, setFormatId] = useState<string | null>(null);
  const [rights, setRights] = useState(false);
  const [owner, setOwner] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const { job } = useJob(jobId);

  const parsed = useMemo(() => parseTikTokUrl(url), [url]);
  const providers = caps?.tiktok.providers ?? [];
  const anyProvider = providers.some((p) => p.enabled);
  const fmt = result?.formats.find((f) => f.id === formatId) ?? null;
  const needsOwner = fmt ? fmt.watermark !== true : false;

  const analyze = async () => {
    setTouched(true);
    if (!parsed.ok) return;
    setResolving(true);
    setError(null);
    setResult(null);
    setJobId(null);
    try {
      const r = await api.tiktokResolve(url);
      setResult(r);
      // default: highest quality watermarked format (no ownership claim needed), else highest overall
      const def = r.formats.find((f) => f.watermark === true) ?? r.formats[0];
      setFormatId(def?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResolving(false);
    }
  };

  const retrieve = async () => {
    if (!result || !fmt) return;
    setStarting(true);
    setError(null);
    try {
      const j = await api.tiktokRetrieve({ url: result.canonicalUrl, formatId: fmt.id, rightsConfirmed: true, ownerConfirmed: owner });
      setJobId(j.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Module B"
        title="TikTok HD Downloader"
        description="Retrieve videos you own or have permission to reuse, in the genuine source qualities available. Private, restricted and DRM-protected content is never bypassed."
      />

      {caps && !anyProvider && (
        <Alert tone="warn" title="Media retrieval is not configured on this server" className="mb-5">
          Link validation and metadata (via TikTok&apos;s official oEmbed API) work, but oEmbed does not provide video files. To enable downloads the operator must connect an authorized provider — see the README section &ldquo;TikTok retrieval&rdquo;.{" "}
          {providers.map((p) => (
            <span key={p.id} className="mt-1 block text-xs">
              • {p.label}: {p.reason}
            </span>
          ))}
        </Alert>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader icon={<Link2 className="size-4" />} title="Paste a TikTok link" subtitle="tiktok.com/@user/video/…, vm.tiktok.com/…, vt.tiktok.com/…" />
            <div className="p-5">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void analyze();
                }}
                className="flex flex-col gap-2 sm:flex-row"
              >
                <div className={cn("flex h-12 flex-1 items-center rounded-xl border bg-ink-900 pl-4 pr-1", touched && url && !parsed.ok ? "border-bad/60" : "border-line focus-within:border-volt/60")}>
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onBlur={() => setTouched(true)}
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="https://www.tiktok.com/@creator/video/7300000000000000000"
                    className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
                    aria-label="TikTok URL"
                  />
                  {url && (
                    <button type="button" aria-label="Clear URL" onClick={() => { setUrl(""); setResult(null); setError(null); setTouched(false); setJobId(null); }} className="grid size-10 place-items-center rounded-lg text-faint hover:bg-ink-700 hover:text-fg">
                      <X className="size-4" />
                    </button>
                  )}
                </div>
                <Button type="submit" variant="primary" size="lg" loading={resolving} disabled={!url} icon={<ScanSearch className="size-4" />}>
                  Analyze
                </Button>
              </form>
              <div className="mt-2.5 min-h-5 text-xs">
                {url && parsed.ok && (
                  <span className="flex items-center gap-1.5 text-ok">
                    <CircleCheck className="size-3.5" /> {parsed.kind === "short" ? "Short link — will be expanded via TikTok" : `Video link${parsed.username ? ` by @${parsed.username}` : ""} · ID ${parsed.videoId}`}
                  </span>
                )}
                {touched && url && !parsed.ok && <span className="text-bad">{parsed.reason}</span>}
              </div>
              {error && <Alert tone="bad" className="mt-3">{error}</Alert>}
            </div>
          </Card>

          {result && (
            <Card>
              <CardHeader icon={<ScanSearch className="size-4" />} title="Video information" subtitle={`Source: ${result.metadata.source}`} />
              <div className="grid gap-5 p-5 sm:grid-cols-[180px_1fr]">
                <div className="overflow-hidden rounded-xl border border-line bg-ink-900">
                  {result.metadata.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={result.metadata.thumbnailUrl} alt="Video thumbnail" referrerPolicy="no-referrer" className="aspect-[9/16] w-full object-cover" />
                  ) : (
                    <div className="grid aspect-[9/16] place-items-center text-xs text-faint">No thumbnail</div>
                  )}
                </div>
                <div className="min-w-0 space-y-4">
                  <div>
                    <div className="label-xs">Title</div>
                    <div className="mt-1 text-sm">{result.metadata.title ?? <span className="text-faint">Not provided</span>}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="label-xs">Creator</div>
                      <div className="mt-1 text-sm font-semibold">{result.metadata.author ? (result.metadata.authorUrl ? <a className="hover:text-volt" href={result.metadata.authorUrl} target="_blank" rel="noreferrer noopener">@{result.metadata.author}</a> : `@${result.metadata.author}`) : <span className="text-faint">Not provided</span>}</div>
                    </div>
                    <div>
                      <div className="label-xs">Duration</div>
                      <div className="num mt-1 text-sm">{result.metadata.duration ? fmtDuration(result.metadata.duration) : <span className="text-faint">Not provided</span>}</div>
                    </div>
                  </div>
                  <div>
                    <div className="label-xs mb-2">Available source qualities</div>
                    {result.formats.length ? (
                      <div className="space-y-2" role="radiogroup">
                        {result.formats.map((f) => (
                          <label key={f.id} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-[13px]", formatId === f.id ? "border-volt/60 bg-volt/[0.05]" : "border-line bg-ink-900 hover:border-ink-600")}>
                            <input type="radio" name="fmt" checked={formatId === f.id} onChange={() => setFormatId(f.id)} />
                            <span className="min-w-0 flex-1">
                              <span className="font-semibold">{f.width && f.height ? `${f.width}×${f.height}` : f.label}</span>
                              <span className="num ml-2 text-xs text-muted">{[f.vcodec, f.ext.toUpperCase(), f.bitrateKbps ? `${f.bitrateKbps} kbps` : null, f.filesize ? fmtBytes(f.filesize) : null].filter(Boolean).join(" · ")}</span>
                            </span>
                            <Badge tone={f.watermark === true ? "neutral" : f.watermark === false ? "volt" : "warn"}>{f.watermark === true ? "Watermarked" : f.watermark === false ? "No watermark" : "Watermark unknown"}</Badge>
                          </label>
                        ))}
                        <p className="text-xs text-faint">Only qualities the source actually provides are listed. Nothing is upscaled or relabelled as HD.</p>
                      </div>
                    ) : (
                      <Alert tone="warn">{result.retrievalNote}</Alert>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {job && <JobPanel job={job} />}
          {job?.status === "done" && job.retrieve && (
            <Card className="glow-soft">
              <CardHeader icon={<CircleCheck className="size-4 !text-ok" />} title="Video retrieved and verified" subtitle={`${fmtBytes(job.retrieve.size)} · checked with FFprobe · available for ${caps?.limits.fileTtlMin ?? 60} min`} />
              <div className="space-y-5 p-5">
                <MediaInfoGrid info={job.retrieve.info} size={job.retrieve.size} dense />
                <div className="flex flex-wrap gap-2">
                  <Link href={`/compress?file=${job.retrieve.fileId}`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-volt px-4 text-sm font-semibold text-ink-950 glow-soft hover:bg-[#f5ff4d]">
                    <Gauge className="size-4" /> Compress this video
                  </Link>
                  <ButtonLink href={mediaUrl(job.retrieve.fileId, true)} download icon={<Download className="size-4" />}>Download MP4</ButtonLink>
                </div>
                {result?.metadata.author && <p className="text-xs text-faint">Credit: @{result.metadata.author} on TikTok. Keep attribution when reusing.</p>}
              </div>
            </Card>
          )}
          {(job?.status === "failed" || job?.status === "cancelled") && <Alert tone="bad" title="Retrieval did not complete">{job.explanation ?? job.error}</Alert>}
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader icon={<ShieldCheck className="size-4" />} title="Rights & retrieval" />
            <div className="space-y-4 p-5 text-[13px]">
              <label className="flex cursor-pointer gap-3">
                <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5 size-4 shrink-0" />
                <span>I own this video or have permission from its owner to download and reuse it.</span>
              </label>
              <label className={cn("flex cursor-pointer gap-3", !needsOwner && "opacity-60")}>
                <input type="checkbox" checked={owner} onChange={(e) => setOwner(e.target.checked)} className="mt-0.5 size-4 shrink-0" />
                <span>
                  I am the creator of this video, or have explicit permission to use it <b>without</b> TikTok&apos;s watermark.
                  <span className="mt-1 block text-xs text-faint">Required for watermark-free or unlabelled formats. Otherwise attribution marks are preserved.</span>
                </span>
              </label>
              <Button variant="primary" size="lg" className="w-full" icon={<Download className="size-4" />} loading={starting} disabled={!result?.retrievalAvailable || !fmt || !rights || (needsOwner && !owner) || (!!job && (job.status === "queued" || job.status === "running"))} onClick={retrieve}>
                Retrieve video
              </Button>
              {result && !result.retrievalAvailable && <p className="text-xs text-muted">Retrieval is unavailable for this video: {result.retrievalNote}</p>}
              {fmt && needsOwner && !owner && <p className="text-xs text-warn">This format {fmt.watermark === false ? "has no watermark" : "has an unknown watermark status"} — confirm ownership/permission or pick a watermarked format.</p>}
            </div>
          </Card>
          <Card>
            <div className="space-y-2.5 p-5 text-xs leading-relaxed text-muted">
              <div className="label-xs">How this works</div>
              <p>1. The link is validated locally, short links are expanded only through TikTok domains.</p>
              <p>2. Metadata comes from TikTok&apos;s official public oEmbed endpoint — private or deleted videos return nothing.</p>
              <p>3. Media is fetched only through a provider configured by the operator, then verified with FFprobe before it is offered.</p>
              <p>4. Hand the file to the Compressor in one click.</p>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
