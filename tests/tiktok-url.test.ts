import { describe, expect, it } from "vitest";
import { parseTikTokUrl } from "@/lib/tiktok-url";

describe("parseTikTokUrl", () => {
  it("accepts standard video URLs and strips tracking params", () => {
    const r = parseTikTokUrl("https://www.tiktok.com/@scout2015/video/6718335390845095173?is_from_webapp=1&sender_device=pc");
    expect(r.ok).toBe(true);
    expect(r.canonical).toBe("https://www.tiktok.com/@scout2015/video/6718335390845095173");
    expect(r.videoId).toBe("6718335390845095173");
  });
  it("accepts mobile and scheme-less links", () => {
    expect(parseTikTokUrl("m.tiktok.com/@a.b_c/video/7300000000000000000").ok).toBe(true);
  });
  it("accepts short links", () => {
    expect(parseTikTokUrl("https://vm.tiktok.com/ZMabc123/").kind).toBe("short");
    expect(parseTikTokUrl("https://www.tiktok.com/t/ZTabc123/").kind).toBe("short");
  });
  it("rejects lookalike and non-TikTok hosts", () => {
    expect(parseTikTokUrl("https://tiktok.com.evil.io/@a/video/7300000000000000000").ok).toBe(false);
    expect(parseTikTokUrl("https://example.com/@a/video/7300000000000000000").ok).toBe(false);
    expect(parseTikTokUrl("javascript:alert(1)").ok).toBe(false);
  });
  it("rejects profiles, photos and live", () => {
    expect(parseTikTokUrl("https://www.tiktok.com/@someone").ok).toBe(false);
    expect(parseTikTokUrl("https://www.tiktok.com/@someone/photo/7300000000000000000").kind).toBe("photo");
    expect(parseTikTokUrl("https://www.tiktok.com/@someone/live").ok).toBe(false);
  });
  it("rejects credentials and odd ports", () => {
    expect(parseTikTokUrl("https://user:pw@www.tiktok.com/@a/video/7300000000000000000").ok).toBe(false);
    expect(parseTikTokUrl("https://www.tiktok.com:8443/@a/video/7300000000000000000").ok).toBe(false);
  });
});
