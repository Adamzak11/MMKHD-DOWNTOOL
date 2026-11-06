import "server-only";
import { z } from "zod";

const id = z.string().regex(/^[a-f0-9]{32}$/, "invalid id");
const codec = z.enum(["auto", "h264", "h265", "av1"]);

export const compressRequestSchema = z.object({
  fileId: id,
  mode: z.enum(["lossless", "smart", "strict", "custom"]),
  qualityPreference: z.enum(["high", "balanced", "max"]).default("balanced"),
  targetSizeMB: z.number().min(0.5).max(4000).default(9.5),
  codec: codec.default("auto"),
  audio: z.object({ mode: z.enum(["auto", "copy", "aac", "remove"]), bitrateKbps: z.number().int().min(32).max(320) }).default({ mode: "auto", bitrateKbps: 128 }),
  custom: z
    .object({
      codec,
      targetSizeMB: z.number().min(0.5).max(4000).nullable(),
      maxBitrateKbps: z.number().int().min(100).max(10_000).nullable(),
      resolution: z.number().int().min(144).max(4320).nullable(),
      fps: z.number().min(1).max(240).nullable(),
    })
    .optional(),
  lossless: z.object({ container: z.enum(["auto", "mp4", "mkv"]) }).optional(),
  qualityGuard: z.boolean().default(true),
  vmaf: z.boolean().default(false),
});

export const tiktokResolveSchema = z.object({ url: z.string().min(1).max(2048) });

export const tiktokRetrieveSchema = z.object({
  url: z.string().min(1).max(2048),
  formatId: z.string().min(1).max(80).regex(/^[A-Za-z0-9_.\-]+$/),
  rightsConfirmed: z.literal(true, { message: "You must confirm you own this video or have permission to download and reuse it" }),
  ownerConfirmed: z.boolean().default(false),
});
