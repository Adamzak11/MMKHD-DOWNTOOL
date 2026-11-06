import { describe, expect, it } from "vitest";
import { parseProbe, parseRate } from "@/lib/probe-parse";

describe("parseProbe", () => {
  it("applies rotation to display size and reads rates", () => {
    const info = parseProbe(
      {
        format: { format_name: "mov", duration: "5.0", size: "1000", bit_rate: "1600" },
        streams: [
          { index: 0, codec_type: "video", codec_name: "h264", width: 1920, height: 1080, r_frame_rate: "30000/1001", avg_frame_rate: "30000/1001", pix_fmt: "yuv420p", side_data_list: [{ rotation: -90 }] },
          { index: 1, codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 },
        ],
      },
      1000,
    );
    expect(info.video!.width).toBe(1080);
    expect(info.video!.height).toBe(1920);
    expect(info.video!.rotation).toBe(270);
    expect(info.video!.fps).toBeCloseTo(29.97, 2);
    expect(info.video!.bitDepth).toBe(8);
  });
  it("ignores cover art and handles missing audio", () => {
    const info = parseProbe({ format: { duration: "2" }, streams: [{ index: 0, codec_type: "video", codec_name: "mjpeg", disposition: { attached_pic: 1 } }, { index: 1, codec_type: "video", codec_name: "hevc", width: 640, height: 360, pix_fmt: "yuv420p10le", avg_frame_rate: "25/1", r_frame_rate: "25/1" }] }, 10);
    expect(info.video!.index).toBe(1);
    expect(info.video!.bitDepth).toBe(10);
    expect(info.audio).toBeNull();
  });
  it("parseRate handles bad input", () => {
    expect(parseRate("0/0")).toBeNull();
    expect(parseRate("25")).toBe(25);
  });
});
