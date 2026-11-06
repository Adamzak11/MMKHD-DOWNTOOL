import { aspectLabel, codecName, fmtBitrate, fmtBytes, fmtDuration, fmtFps } from "./format";
import type { MediaInfo } from "./types";

export function reportSections(info: MediaInfo, name: string, size: number) {
  const v = info.video;
  const a = info.audio;
  return [
    {
      title: "Video",
      rows: v
        ? ([
            ["Resolution", `${v.width}×${v.height}${v.rotation ? ` (stored ${v.codedWidth}×${v.codedHeight}, rotation ${v.rotation}°)` : ""}`],
            ["Frame rate", `${fmtFps(v.fps)} fps${v.isVfr ? " (variable)" : ""}`],
            ["Codec", `${codecName(v.codec)}${v.profile ? ` · ${v.profile}` : ""}`],
            ["Bitrate", fmtBitrate(v.bitrate)],
            ["Duration", fmtDuration(info.duration)],
            ["Aspect ratio", `${aspectLabel(v.width, v.height)}${v.displayAspectRatio ? ` (DAR ${v.displayAspectRatio})` : ""}`],
            ["Pixel format", `${v.pixFmt ?? "—"}${v.bitDepth ? ` · ${v.bitDepth}-bit` : ""}`],
            ["Frame count", v.frameCount !== null ? String(v.frameCount) : "not stored in container"],
            ["Colour", [v.colorPrimaries, v.colorTransfer, v.colorSpace, v.colorRange].filter(Boolean).join(" / ") || "unspecified"],
          ] as [string, string][])
        : ([["Video", "No video stream"]] as [string, string][]),
    },
    {
      title: "Audio",
      rows: a
        ? ([
            ["Codec", `${codecName(a.codec)}${a.profile ? ` · ${a.profile}` : ""}`],
            ["Sample rate", a.sampleRate ? `${(a.sampleRate / 1000).toFixed(1)} kHz` : "—"],
            ["Channels", a.channels ? `${a.channels}${a.channelLayout ? ` (${a.channelLayout})` : ""}` : "—"],
            ["Bitrate", `${fmtBitrate(a.bitrate)}${a.bitrateEstimated ? " (estimated)" : ""}`],
            ["Audio tracks", String(info.audioStreamCount)],
          ] as [string, string][])
        : ([["Audio", "No audio stream"]] as [string, string][]),
    },
    {
      title: "Container",
      rows: [
        ["File", name],
        ["File size", `${fmtBytes(size)} (${size.toLocaleString()} bytes)`],
        ["Format", info.formatLong ?? info.formatName],
        ["Overall bitrate", fmtBitrate(info.bitrate)],
        ["Subtitle tracks", String(info.subtitleStreamCount)],
      ] as [string, string][],
    },
  ];
}

export function reportText(info: MediaInfo, name: string, size: number) {
  const lines = ["MAMATKILAT VIDEO TOOLS — Technical report", `Generated ${new Date().toISOString()}`, ""];
  for (const s of reportSections(info, name, size)) {
    lines.push(`[${s.title.toUpperCase()}]`);
    for (const [k, v] of s.rows) lines.push(`${k.padEnd(16)} ${v}`);
    lines.push("");
  }
  return lines.join("\n");
}
