import "server-only";
import fs from "node:fs/promises";
import { config } from "./config";
import { run } from "./process";
import { parseProbe } from "@/lib/probe-parse";
import type { MediaInfo } from "@/lib/types";

export async function probe(filePath: string, signal?: AbortSignal): Promise<MediaInfo> {
  const stat = await fs.stat(filePath);
  const { stdout } = await run(
    config.ffprobe,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-i", filePath],
    { collectStdout: true, signal, timeoutMs: 60_000 },
  );
  return parseProbe(JSON.parse(stdout), stat.size);
}

/** Count decoded frames exactly (slow; used only when the container lacks nb_frames). */
export async function countFrames(filePath: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const { stdout } = await run(
      config.ffprobe,
      ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", "-i", filePath],
      { collectStdout: true, signal, timeoutMs: 120_000 },
    );
    const n = parseInt(stdout.trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
