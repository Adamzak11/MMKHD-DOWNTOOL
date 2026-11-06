#!/usr/bin/env bash
# Generates synthetic test videos covering the cases in the spec.
# Sources are encoded at high quality so compression results are meaningful.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p fixtures
F="ffmpeg -hide_banner -loglevel error -y"
HQ="-c:v libx264 -preset veryfast -crf 16 -pix_fmt yuv420p"
AUD="-f lavfi -i sine=frequency=440:sample_rate=48000"
# moderate temporal grain makes synthetic content behave more like camera footage
SRC="testsrc2=s=1920x1080:r=30,noise=c0s=14:c1s=6:c2s=6,noise=alls=2:allf=t"

gen() { echo "→ $1"; }

gen 5s_1080p_audio;      $F -f lavfi -i "$SRC" $AUD -t 5  $HQ -c:a aac -b:a 192k -shortest fixtures/5s_1080p_audio.mp4
gen 15s_1080p_audio;     $F -f lavfi -i "$SRC" $AUD -t 15 $HQ -c:a aac -b:a 192k -shortest fixtures/15s_1080p_audio.mp4
gen 30s_1080p_audio;     $F -f lavfi -i "$SRC" $AUD -t 30 $HQ -c:a aac -b:a 128k -shortest fixtures/30s_1080p_audio.mp4
gen 60s_1080p_audio;     $F -f lavfi -i "$SRC" $AUD -t 60 $HQ -c:a aac -b:a 128k -shortest fixtures/60s_1080p_audio.mp4
gen 10s_4k_audio;        $F -f lavfi -i "testsrc2=s=3840x2160:r=30,noise=c0s=14:c1s=6:c2s=6,noise=alls=2:allf=t" $AUD -t 10 $HQ -c:a aac -b:a 128k -shortest fixtures/10s_4k_audio.mp4
gen 10s_highmotion_60fps; $F -f lavfi -i "testsrc2=s=1920x1080:r=60,noise=alls=30:allf=t+u" $AUD -t 10 $HQ -c:a aac -b:a 128k -shortest fixtures/10s_highmotion_1080p60.mp4
gen 15s_lowlight;        $F -f lavfi -i "testsrc2=s=1920x1080:r=30,eq=brightness=-0.32:contrast=0.45,noise=c0s=10,noise=alls=4:allf=t" $AUD -t 15 $HQ -c:a aac -b:a 128k -shortest fixtures/15s_lowlight_1080p.mp4
gen 15s_noaudio;         $F -f lavfi -i "$SRC" -t 15 $HQ fixtures/15s_1080p_noaudio.mp4
gen 8s_vertical_mov;     $F -f lavfi -i "testsrc2=s=1080x1920:r=30,noise=c0s=14:c1s=6:c2s=6,noise=alls=2:allf=t" $AUD -t 8 $HQ -c:a aac -b:a 128k -shortest fixtures/8s_vertical.mov
gen 6s_rotated_mov;      $F -display_rotation 90 -i fixtures/5s_1080p_audio.mp4 -c copy fixtures/5s_rotated.mov
gen 10s_mkv_vp9;         $F -f lavfi -i "$SRC" -f lavfi -i "sine=frequency=330:sample_rate=48000" -t 10 -c:v libvpx-vp9 -b:v 12M -deadline realtime -cpu-used 8 -c:a libopus -b:a 128k -shortest fixtures/10s_vp9_opus.mkv
gen 6s_webm;             $F -f lavfi -i "testsrc2=s=1280x720:r=30" -t 6 -c:v libvpx-vp9 -b:v 4M -deadline realtime -cpu-used 8 fixtures/6s_720p.webm
gen small_already_ok;    $F -f lavfi -i "testsrc2=s=1280x720:r=30" $AUD -t 6 -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 96k -shortest fixtures/6s_720p_small.mp4
gen 10bit_hevc;          $F -f lavfi -i "$SRC" -t 6 -c:v libx265 -preset ultrafast -crf 14 -pix_fmt yuv420p10le -tag:v hvc1 -x265-params log-level=error fixtures/6s_hevc_10bit.mp4
echo "this is not a video" > fixtures/not_a_video.mp4
ls -la fixtures
