/** TikTok URL validation & normalisation (pure; shared by client and server). */

export type TikTokUrlKind = "video" | "short" | "photo" | "unsupported";

export interface ParsedTikTokUrl {
  ok: boolean;
  kind: TikTokUrlKind;
  canonical: string | null;
  videoId: string | null;
  username: string | null;
  reason: string | null;
}

const MAIN_HOSTS = new Set(["tiktok.com", "www.tiktok.com", "m.tiktok.com"]);
const SHORT_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com"]);

export function isTikTokHost(host: string) {
  const h = host.toLowerCase();
  return MAIN_HOSTS.has(h) || SHORT_HOSTS.has(h);
}

export function parseTikTokUrl(input: string): ParsedTikTokUrl {
  const bad = (reason: string, kind: TikTokUrlKind = "unsupported"): ParsedTikTokUrl => ({ ok: false, kind, canonical: null, videoId: null, username: null, reason });
  const raw = input.trim();
  if (!raw) return bad("Paste a TikTok video link.");
  if (raw.length > 2048) return bad("That link is too long.");
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return bad("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return bad("Only http(s) links are supported.");
  if (url.username || url.password || (url.port && url.port !== "443" && url.port !== "80")) return bad("Unsupported URL format.");
  const host = url.hostname.toLowerCase();
  if (!isTikTokHost(host)) return bad("This is not a TikTok link. Supported: tiktok.com/@user/video/…, vm.tiktok.com/…, vt.tiktok.com/…");

  const parts = url.pathname.split("/").filter(Boolean);
  if (SHORT_HOSTS.has(host)) {
    const code = parts[0];
    if (!code || !/^[A-Za-z0-9_-]{5,20}$/.test(code)) return bad("This short link is incomplete.");
    return { ok: true, kind: "short", canonical: `https://${host}/${code}/`, videoId: null, username: null, reason: null };
  }
  // tiktok.com/t/CODE short form
  if (parts[0] === "t" && parts[1] && /^[A-Za-z0-9_-]{5,20}$/.test(parts[1])) {
    return { ok: true, kind: "short", canonical: `https://www.tiktok.com/t/${parts[1]}/`, videoId: null, username: null, reason: null };
  }
  // /@user/video/ID
  if (parts[0]?.startsWith("@") && parts[1] === "video" && /^\d{8,25}$/.test(parts[2] ?? "")) {
    const user = parts[0].slice(1);
    if (!/^[A-Za-z0-9._]{1,40}$/.test(user)) return bad("The username in this link looks invalid.");
    return { ok: true, kind: "video", canonical: `https://www.tiktok.com/@${user}/video/${parts[2]}`, videoId: parts[2], username: user, reason: null };
  }
  if (parts[0]?.startsWith("@") && parts[1] === "photo") return bad("Photo/slideshow posts are not videos and are not supported.", "photo");
  // /v/ID.html and embed links
  const m = url.pathname.match(/^\/(?:v|embed(?:\/v2)?|player\/v1)\/(\d{8,25})(?:\.html)?\/?$/);
  if (m) return { ok: true, kind: "video", canonical: `https://www.tiktok.com${url.pathname.replace(/\/$/, "")}`, videoId: m[1], username: null, reason: null };
  if (parts[0]?.startsWith("@") && parts[1] === "live") return bad("Live streams are not supported.");
  if (parts[0]?.startsWith("@") && parts.length === 1) return bad("This is a profile link. Paste the link of a specific video.");
  return bad("Unsupported TikTok link. Open the video and use Share → Copy link.");
}
