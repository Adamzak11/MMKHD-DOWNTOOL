export function fmtBytes(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(digits)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(digits)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

export function fmtBitrate(bps: number | null | undefined): string {
  if (!bps || !Number.isFinite(bps)) return "—";
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(2)} Mbps`;
  return `${Math.round(bps / 1e3)} kbps`;
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${s.toFixed(2)} s`;
}

export function fmtFps(fps: number | null | undefined): string {
  if (!fps) return "—";
  return Number.isInteger(Math.round(fps * 1000) / 1000) ? `${Math.round(fps)}` : fps.toFixed(3).replace(/0+$/, "");
}

export function fmtEta(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return "";
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
}

export function fmtRelative(t: number): string {
  const d = (Date.now() - t) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

export function aspectLabel(w: number, h: number): string {
  if (!w || !h) return "—";
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  const a = w / g, b = h / g;
  if (a <= 50 && b <= 50) return `${a}:${b}`;
  return `${(w / h).toFixed(3)}:1`;
}

export const codecName = (c: string | null | undefined) =>
  !c ? "—" : ({ h264: "H.264 / AVC", hevc: "H.265 / HEVC", av1: "AV1", vp9: "VP9", vp8: "VP8", aac: "AAC", opus: "Opus", mp3: "MP3", ffv1: "FFV1", alac: "ALAC", flac: "FLAC", prores: "ProRes" } as Record<string, string>)[c] ?? c.toUpperCase();
