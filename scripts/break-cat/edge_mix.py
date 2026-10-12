#!/usr/bin/env python3
"""把超分后的猫视频的轮廓附近换回原片的平滑放大，再交给 make-break-cat.py 抠像。

    python3 scripts/break-cat/edge_mix.py <原片.mp4> <超分1440.mp4> <旧 arrive.webm> <旧 sleep.webm> <输出.mp4> [lo hi]

超分（Real-ESRGAN）会把猫和浅色背景之间的轮廓锐化成一刀切的硬黑边，抠出来就是一圈黑线。
轮廓取自 720p 版抠好的透明度（放大 2 倍）：轮廓往里 lo 像素以内用原片的 lanczos 放大，
lo–hi 像素之间渐变，再往里用超分的毛发细节（默认 4 / 12，按 1440p 像素算）。
旧的 sleep.webm 是来回播的，只取它前 28 帧（第 333–360 帧）。需要 ffmpeg、numpy、scipy。
"""
import subprocess, sys
import numpy as np
from scipy import ndimage as ndi
src, up, oa, osl, out = sys.argv[1:6]
lo, hi = (float(sys.argv[6]), float(sys.argv[7])) if len(sys.argv) > 7 else (4.0, 12.0)
W, H = 2560, 1440
def reader(args, ch):
    p = subprocess.Popen(["ffmpeg", "-v", "error", *args, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24" if ch == 3 else "gray", "-"], stdout=subprocess.PIPE)
    n = W * H * ch
    while True:
        b = p.stdout.read(n)
        if len(b) < n: return
        yield np.frombuffer(b, np.uint8).reshape(H, W, ch) if ch == 3 else np.frombuffer(b, np.uint8).reshape(H, W)
alpha_args = lambda f: ["-c:v", "libvpx-vp9", "-i", f, "-vf", "alphaextract,scale=2560:1440:flags=bilinear"]
def alphas():
    yield from reader(alpha_args(oa), 1)          # 帧 0–333
    for k, a in enumerate(reader(alpha_args(osl), 1)):
        if 1 <= k <= 27: yield a                  # 帧 334–360
        if k > 27: return
lz = reader(["-i", src, "-vf", "scale=2560:1440:flags=lanczos"], 3)
x4 = reader(["-i", up], 3)
enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", "21660/901", "-i", "-",
                        "-c:v", "libx264", "-preset", "slow", "-crf", "8", "-pix_fmt", "yuv444p", out], stdin=subprocess.PIPE)
n = 0
for a, l, x in zip(alphas(), lz, x4):
    inside = ndi.distance_transform_edt(a >= 128)
    w = np.clip((inside - lo) / (hi - lo), 0, 1)[..., None]
    enc.stdin.write(np.clip(w * x + (1 - w) * l + 0.5, 0, 255).astype(np.uint8).tobytes())
    n += 1
enc.stdin.close(); enc.wait()
print("frames", n)
