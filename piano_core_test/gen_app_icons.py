# -*- coding: utf-8 -*-
# 生成 App 图标：蓝色圆角方块 + 白色钢琴键
from PIL import Image, ImageDraw
import os

OUT = r"D:\钢琴\piano-uniapp\src\static\appicons"
os.makedirs(OUT, exist_ok=True)

BLUE = (91, 108, 255, 255)
BLUE_D = (70, 83, 230, 255)

def make(size):
    s = size * 4  # 4x 超采样抗锯齿
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 渐变底（上浅下深的手动画法：逐行插值）
    r = int(s * 0.22)
    for y in range(s):
        t = y / s
        c = tuple(int(BLUE[i] + (BLUE_D[i] - BLUE[i]) * t) for i in range(3)) + (255,)
        d.line([(0, y), (s, y)], fill=c)
    # 圆角蒙版
    mask = Image.new("L", (s, s), 0)
    dm = ImageDraw.Draw(mask)
    dm.rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=255)
    img.putalpha(mask)
    # 白色琴键
    d = ImageDraw.Draw(img)
    pad = int(s * 0.18)
    kb_w = s - 2 * pad
    kb_h = int(s * 0.34)
    kb_y = int(s * 0.33)
    d.rounded_rectangle([pad, kb_y, s - pad, kb_y + kb_h], radius=int(s * 0.03), fill=(255, 255, 255, 255))
    # 分隔线
    for i in (1, 2, 3):
        x = pad + kb_w * i / 4
        d.line([x, kb_y + int(s*0.01), x, kb_y + kb_h - int(s*0.01)], fill=(210, 214, 240, 255), width=max(2, int(s*0.008)))
    # 黑键
    for i in (1, 3):
        x = pad + kb_w * i / 4
        bw = int(kb_w * 0.09)
        bh = int(kb_h * 0.55)
        d.rounded_rectangle([x - bw/2, kb_y + int(s*0.012), x + bw/2, kb_y + int(s*0.012) + bh], radius=int(s*0.008), fill=(40, 44, 70, 255))
    # 音符点（左上装饰）
    cx, cy = int(s*0.26), int(s*0.20)
    d.ellipse([cx - int(s*0.045), cy - int(s*0.045), cx + int(s*0.045), cy + int(s*0.045)], fill=(255, 255, 255, 230))
    d.line([cx + int(s*0.045), cy, cx + int(s*0.045), cy - int(s*0.11)], fill=(255, 255, 255, 230), width=max(2, int(s*0.016)))
    return img.resize((size, size), Image.LANCZOS)

sizes = {"hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
for name, px in sizes.items():
    make(px).save(os.path.join(OUT, f"android-{name}.png"))
make(512).save(os.path.join(OUT, "app-512.png"))
print("icons:", os.listdir(OUT))
