#!/usr/bin/env python3
"""把「浅色背景上的猫」视频抠成休息陪伴要播的两段透明视频（VP9 + alpha）。

    python3 scripts/break-cat/make-break-cat.py <视频.mp4> [--sleep-from 帧号] [--out renderer/assets/break-cat]

需要 ffmpeg（带 libvpx-vp9）以及 numpy、scipy、pillow、rembg（pip install rembg onnxruntime）。
视频要求：机位不动、背景干净（浅色棚拍地面最好），猫从画面右边走进来，最后睡下不怎么动。

做法：
1. 每帧用 rembg 的 isnet-general-use 分出猫的大致轮廓；
2. 用「猫不在附近时最亮的那些帧」拼出一张干净背景（顺带去掉角落的水印）；
3. 比背景暗、又在轮廓里（或在相邻帧轮廓旁、带一点猫毛的紫调）的是猫身，边缘按变暗的程度给半透明，
   颜色从猫身往外渗，不带背景的浅色；轮廓外的变暗是地上的影子，存成半透明的黑；
4. 从 --sleep-from 帧（默认自动找：之后几乎不动的第一帧）切开：前面是 arrive.webm（只播一次），
   后面来回播成 sleep.webm（循环）；最后打印 break-cat.js 里 SLEEP_BOX 该填的数。
"""
import argparse
import os
import subprocess
import sys
import tempfile
import time
from multiprocessing import Pool

import numpy as np
from scipy import ndimage as ndi

LW = np.array([0.299, 0.587, 0.114], np.float32)
K3 = np.ones((3, 3), bool)
K5 = np.ones((5, 5), bool)
BAND = 10  # 猫身外按毛边处理的宽度（像素）
G = {}  # 子进程共享（fork）的帧、轮廓与背景


def probe(video):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate",
                          "-of", "csv=p=0", video], capture_output=True, text=True, check=True).stdout.strip().split(",")
    return int(out[0]), int(out[1]), out[2]


def decode(video, w, h, path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         capture_output=True, check=True).stdout
    n = len(raw) // (w * h * 3)
    frames = np.lib.format.open_memmap(path, mode="w+", dtype=np.uint8, shape=(n, h, w, 3))
    frames[:] = np.frombuffer(raw, np.uint8)[: n * w * h * 3].reshape(n, h, w, 3)
    frames.flush()
    return np.load(path, mmap_mode="r")


def segment(frames, path):
    from PIL import Image
    from rembg import new_session, remove
    session = new_session("isnet-general-use")
    masks = np.lib.format.open_memmap(path, mode="w+", dtype=np.uint8, shape=frames.shape[:3])
    t0 = time.time()
    for i in range(frames.shape[0]):
        masks[i] = np.array(remove(Image.fromarray(np.array(frames[i])), session=session, only_mask=True))
        if i % 60 == 0:
            print(f"  轮廓 {i}/{frames.shape[0]}  {time.time() - t0:.0f}s", flush=True)
    masks.flush()
    return np.load(path, mmap_mode="r")


def background_plate(frames, masks):
    """每个像素取猫不在附近时最亮的几帧的平均。"""
    n, h, w, _ = frames.shape
    near = np.empty((n, h, w), bool)
    for i in range(n):
        a, b = max(0, i - 1), min(n - 1, i + 1)
        smooth = (masks[a].astype(np.float32) + 2 * masks[i].astype(np.float32) + masks[b].astype(np.float32)) / (4 * 255)
        near[i] = ndi.maximum_filter(smooth, size=31) > 0.02
    plate = np.zeros((h, w, 3), np.float32)
    for r0 in range(0, h, 24):
        r1 = min(h, r0 + 24)
        block = frames[:, r0:r1].astype(np.float32)
        lum = block @ LW
        ok = ~near[:, r0:r1]
        top = np.where(ok, lum, -1).max(0)
        pick = ok & (lum >= top[None] - 3)
        count = pick.sum(0)
        part = (block * pick[..., None]).sum(0) / np.maximum(count, 1)[..., None]
        part[count == 0] = block.max(0)[count == 0]
        plate[r0:r1] = part
    return plate


def frame_rgba(i):
    F, M, B = G["frames"], G["masks"], G["plate"]
    lumB = G["lumB"]
    n, h, w, _ = F.shape
    f = F[i].astype(np.float32)
    ml = M[i].astype(np.float32) / 255
    s = np.clip(1 - (f @ LW) / np.maximum(lumB, 1), 0, 1)               # 比背景暗多少
    q = f / np.maximum(B, 1)
    qn = ndi.uniform_filter(q / np.maximum(q.mean(-1, keepdims=True), 1e-3), size=(7, 7, 1))
    purple = (qn[..., 0] + qn[..., 2]) / 2 - qn[..., 1]                   # 猫毛偏一点紫，影子是中性的
    seg = ml > 0.5
    deep = ndi.binary_erosion(seg, iterations=6)

    # 1) 实心的猫：在轮廓里且明显比背景暗（浅色肚皮要再带一点紫调）
    solid = seg & ((s >= 0.45) | ((s >= 0.15) & (purple >= 0.025)))
    # 轮廓偶尔漏掉一帧里甩动的尾巴：在相邻帧轮廓旁、够暗、带紫调的大块补回来
    span = np.max(np.stack([M[k] for k in range(max(0, i - 2), min(n, i + 3))]), 0) > 40
    span = ndi.binary_dilation(span, iterations=12)
    extra = ndi.binary_opening(span & ~seg & (s >= 0.22) & (purple >= 0.035), structure=K5)
    lab, count = ndi.label(extra)
    if count:
        idx = np.arange(1, count + 1)
        big = (ndi.sum(np.ones_like(s), lab, idx) >= 600) & (ndi.mean(purple, lab, idx) >= 0.05)
        extra &= np.isin(lab, idx[big])
    lab, count = ndi.label(extra | solid)
    if count:
        touching = np.unique(lab[solid])
        extra &= np.isin(lab, touching[touching > 0])
    solid = ndi.binary_opening(solid | extra, structure=K3)
    # 胡须、眼睛、鼻子是猫身里面的浅色小块：填回去
    solid |= ndi.binary_closing(solid, structure=K5) & deep
    holes = ndi.binary_fill_holes(solid) & ~solid & deep
    lab, count = ndi.label(holes)
    if count:
        keep = np.zeros(count + 1, bool)
        keep[1:] = ndi.sum(np.ones_like(s), lab, range(1, count + 1)) < 2500
        solid |= keep[lab]
    lab, count = ndi.label(solid)
    if count > 1:
        sizes = ndi.sum(np.ones_like(s), lab, range(1, count + 1))
        solid &= np.isin(lab, np.nonzero(sizes >= 400)[0] + 1)

    # 2) 毛边：猫身外一圈（BAND 像素）按「已知背景抠像」算透明度——像素颜色在背景色和旁边猫毛颜色之间
    #    落在哪儿，透明度就是多少。这样蓬松的毛尖能保留下来，也不会把边上的暗色当成影子描出一圈黑边。
    solid = ndi.binary_erosion(solid, iterations=1)  # 最外一圈常是猫毛和背景的混色，重新算
    dist = ndi.distance_transform_edt(~solid)
    wi = solid.astype(np.float32)
    w3 = ndi.gaussian_filter(wi, 3)
    bleed = lambda sig, wc: np.stack([ndi.gaussian_filter(f[..., k] * wi, sig) for k in range(3)], -1) / np.maximum(wc, 1e-4)[..., None]
    fg = np.where((w3 > 0.02)[..., None], bleed(3, w3), bleed(10, ndi.gaussian_filter(wi, 10)))  # 旁边猫毛的颜色
    s_bg = np.clip(1 - (f @ LW) / np.maximum(lumB, 1), 0, 1)
    # 地上的影子：在毛边外侧量出来再带进毛边里，抠像就把它当「影子里的地面」，不会误认成毛
    ring = ((dist > BAND) & (dist <= BAND + 8)).astype(np.float32)
    wr = ndi.gaussian_filter(ring, 6)
    sh_in = np.where(wr > 1e-3, np.clip(ndi.gaussian_filter(s_bg * ring, 6) / np.maximum(wr, 1e-4), 0, 0.6), 0)
    Bs = np.where((dist <= BAND)[..., None], B * (1 - sh_in[..., None]), B)
    d = Bs - fg
    a = np.clip(((Bs - f) * d).sum(-1) / np.maximum((d * d).sum(-1), 30.0), 0, 1)
    a = np.clip((a - 0.05) / 0.95, 0, 1) * np.clip((BAND - dist) / 3, 0, 1)
    # 贴地的地方（肚皮、爪子底下）分不清毛和影子：退回 1 像素羽化的干净边，剩下交给影子层
    w_fur = np.clip(1 - (sh_in - 0.04) / 0.08, 0, 1)
    a_cat = np.where(solid, 1.0, w_fur * a + (1 - w_fur) * np.clip(1.5 - dist, 0, 1)).astype(np.float32)
    a_cat = np.where(ndi.maximum_filter(a_cat, size=3) < 0.12, 0, a_cat)  # 去掉零星噪点
    # 3) 地上的影子：猫的透明度解释不了的那部分变暗，存成半透明的黑
    prox = ndi.uniform_filter(ndi.maximum_filter(ml, size=121), size=41)
    pred = a_cat[..., None] * fg + (1 - a_cat[..., None]) * B
    s_res = np.clip(1 - (f @ LW) / np.maximum(pred @ LW, 1), 0, 1)
    s_sh = np.where(dist <= BAND, np.maximum(s_res, sh_in * (1 - w_fur)), s_bg)
    a_sh = ndi.gaussian_filter(np.clip(s_sh - 0.015, 0, 0.55) * np.clip(prox * 1.5, 0, 1), 1.0)
    # 4) 边缘颜色：够实的毛用解出来的真实颜色，越透明越靠旁边猫毛的颜色，不带背景的浅色
    solved = np.clip((f - (1 - a_cat[..., None]) * Bs) / np.maximum(a_cat, 1e-3)[..., None], 0, 255)
    k = np.clip((a_cat - 0.35) / 0.5, 0, 1)[..., None]
    c = np.where(ndi.binary_erosion(solid, iterations=2)[..., None], f, k * solved + (1 - k) * fg)
    A = a_cat + (1 - a_cat) * a_sh
    rgb = np.where(A[..., None] > 1e-3, a_cat[..., None] * c / np.maximum(A, 1e-3)[..., None], 0)
    out = np.empty((h, w, 4), np.uint8)
    out[..., :3] = np.clip(rgb + 0.5, 0, 255)
    out[..., 3] = np.clip(A * 255 + 0.5, 0, 255)
    return out


def find_sleep_start(rgba, quiet=0.6):
    """之后每帧变化都很小的第一帧。"""
    n = rgba.shape[0]
    diffs = [float(np.abs(rgba[i].astype(np.int16) - rgba[i - 1].astype(np.int16)).mean()) for i in range(1, n)]
    start = n - 1
    for i in range(n - 2, -1, -1):
        if diffs[i] >= quiet:
            break
        start = i
    return start


def encode(rgba, frames, rate, path, w, h):
    cmd = ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{w}x{h}", "-r", rate, "-i", "-",
           "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "32", "-auto-alt-ref", "0",
           "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", "-g", "120", "-an", path]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in frames:
        proc.stdin.write(np.ascontiguousarray(rgba[i]).tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        sys.exit(f"ffmpeg 编码 {path} 失败")


def bbox(rgba, frames, threshold=250):
    x0 = y0 = 10 ** 9
    x1 = y1 = -1
    for i in frames:
        ys, xs = np.nonzero(rgba[i, ..., 3] >= threshold)
        if len(xs):
            x0, y0, x1, y1 = min(x0, xs.min()), min(y0, ys.min()), max(x1, xs.max()), max(y1, ys.max())
    return x0, y0, x1, y1


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video")
    parser.add_argument("--sleep-from", type=int, default=None, help="从这一帧开始算睡着（默认自动找）")
    parser.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "..", "renderer", "assets", "break-cat"))
    parser.add_argument("--work", default=None, help="中间文件放哪（默认临时目录，约 3 GB）")
    args = parser.parse_args()
    work = args.work or tempfile.mkdtemp(prefix="break-cat-")
    os.makedirs(work, exist_ok=True)
    os.makedirs(args.out, exist_ok=True)
    w, h, rate = probe(args.video)
    print(f"视频 {w}×{h} @ {rate}，中间文件在 {work}", flush=True)
    frames = decode(args.video, w, h, os.path.join(work, "frames.npy"))
    print(f"1/4 解出 {frames.shape[0]} 帧，分轮廓（每帧约 1 秒）", flush=True)
    masks = segment(frames, os.path.join(work, "masks.npy"))
    print("2/4 拼背景", flush=True)
    plate = background_plate(frames, masks)
    G.update(frames=frames, masks=masks, plate=plate, lumB=plate @ LW)
    print("3/4 抠像", flush=True)
    rgba = np.lib.format.open_memmap(os.path.join(work, "rgba.npy"), mode="w+", dtype=np.uint8, shape=(frames.shape[0], h, w, 4))
    with Pool(os.cpu_count() or 2) as pool:
        for i, frame in enumerate(pool.imap(frame_rgba, range(frames.shape[0]), chunksize=4)):
            rgba[i] = frame
    rgba.flush()
    n = frames.shape[0]
    cut = args.sleep_from if args.sleep_from is not None else find_sleep_start(rgba)
    cut = max(1, min(n - 2, cut))
    print(f"4/4 编码：arrive 0–{cut}，sleep {cut}–{n - 1} 来回播", flush=True)
    encode(rgba, range(0, cut + 1), rate, os.path.join(args.out, "arrive.webm"), w, h)
    encode(rgba, list(range(cut, n)) + list(range(n - 2, cut, -1)), rate, os.path.join(args.out, "sleep.webm"), w, h)
    x0, y0, x1, y1 = bbox(rgba, range(cut, n))
    print(f"完成。break-cat.js 的 SLEEP_BOX = {{ left: {x0 / w:.3f}, right: {(x1 + 1) / w:.3f}, bottom: {(y1 + 1) / h:.3f} }}")


if __name__ == "__main__":
    main()
