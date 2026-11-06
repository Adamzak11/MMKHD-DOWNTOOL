"use client";
import { Stat } from "./ui";
import { aspectLabel, codecName, fmtBitrate, fmtBytes, fmtDuration, fmtFps } from "@/lib/format";
import type { MediaInfo } from "@/lib/types";

export function MediaInfoGrid({ info, size, dense = false }: { info: MediaInfo; size?: number; dense?: boolean }) {
  const v = info.video;
  const a = info.audio;
  return (
    <div className={dense ? "grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4" : "grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:grid-cols-4"}>
      <Stat label="File size" value={fmtBytes(size ?? info.size)} />
      <Stat label="Duration" value={fmtDuration(info.duration)} />
      <Stat label="Resolution" value={v ? `${v.width}×${v.height}` : "—"} sub={v?.rotation ? `stored ${v.codedWidth}×${v.codedHeight}, rotated ${v.rotation}°` : v ? aspectLabel(v.width, v.height) : undefined} />
      <Stat label="Frame rate" value={v?.fps ? `${fmtFps(v.fps)} fps` : "—"} sub={v?.isVfr ? "variable" : "constant"} />
      <Stat label="Video codec" value={codecName(v?.codec)} sub={v?.profile ?? undefined} />
      <Stat label="Audio codec" value={a ? codecName(a.codec) : "No audio"} sub={a ? `${a.sampleRate ? a.sampleRate / 1000 + " kHz" : ""}${a.channels ? ` · ${a.channels === 1 ? "mono" : a.channels === 2 ? "stereo" : a.channels + " ch"}` : ""}` : undefined} />
      <Stat label="Overall bitrate" value={fmtBitrate(info.bitrate)} sub={v?.bitrate ? `video ${fmtBitrate(v.bitrate)}` : undefined} />
      <Stat label="Pixel format" value={v?.pixFmt ?? "—"} sub={v?.bitDepth ? `${v.bitDepth}-bit` : undefined} />
    </div>
  );
}
