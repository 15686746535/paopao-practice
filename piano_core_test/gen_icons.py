# -*- coding: utf-8 -*-
# 生成 uni-app tabBar 图标（81x81，普通灰 + 选中蓝）
from PIL import Image, ImageDraw
import os

OUT = r"D:\钢琴\piano-uniapp\src\static\tab"
os.makedirs(OUT, exist_ok=True)
GRAY = (154, 160, 176, 255)
BLUE = (91, 108, 255, 255)
S = 81

def canvas():
    return Image.new("RGBA", (S, S), (0, 0, 0, 0))

def piano(color):
    img = canvas(); d = ImageDraw.Draw(img)
    # 琴键外框
    d.rounded_rectangle([12, 22, 69, 59], radius=6, outline=color, width=5)
    # 白键分隔
    for x in (26, 41, 55):
        d.line([x, 25, x, 56], fill=color, width=3)
    # 黑键
    for x in (33, 48):
        d.rectangle([x - 3, 25, x + 3, 42], fill=color)
    return img

def note(color):
    img = canvas(); d = ImageDraw.Draw(img)
    d.ellipse([20, 44, 40, 64], fill=color)          # 符头
    d.line([38, 54, 38, 16], fill=color, width=6)     # 符干
    d.polygon([(38, 16), (58, 22), (58, 34), (38, 28)], fill=color)  # 符尾
    return img

def person(color):
    img = canvas(); d = ImageDraw.Draw(img)
    d.ellipse([29, 12, 52, 35], outline=color, width=6)               # 头
    d.arc([16, 38, 65, 80], 180, 360, fill=color, width=6)            # 肩
    return img

for name, fn in [("play", piano), ("lib", note), ("me", person)]:
    fn(GRAY).save(os.path.join(OUT, f"{name}.png"))
    fn(BLUE).save(os.path.join(OUT, f"{name}-on.png"))
print("icons written:", os.listdir(OUT))
