#!/usr/bin/env python3
"""Ham ekran görüntülerini (<dir>/_raw) aynı boyutta, banner ile uyumlu pencere çerçevesine alır.
Kullanım: python3 docs/frame.py docs/screenshots/<tr|en> <tr|en>"""
import os, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

out_dir, lang = sys.argv[1], sys.argv[2]
raw = os.path.join(out_dir, '_raw')

OUT_W = 1920               # çıktı genişliği
PAD = 64                   # kenar boşluğu
BAR = 46                   # pencere başlık çubuğu
RADIUS = 14
CONTENT_W = OUT_W - 2 * PAD
CONTENT_H = round(CONTENT_W * 800 / 1280)
OUT_H = PAD + BAR + CONTENT_H + PAD

T = {
    'en': {'01-live-panel': 'cappadocia.jpg — travel.example', '02-page-scan': 'Travel Journal — travel.example',
           '03-clean': 'MetaLens Viewer', '04-office': 'MetaLens Viewer', '05-video-location': 'MetaLens Viewer',
           '06-dark-pdf': 'MetaLens Viewer', '07-multi-file': 'MetaLens Viewer'},
    'tr': {'01-live-panel': 'kapadokya.jpg — gezi.example', '02-page-scan': 'Gezi Günlüğü — gezi.example',
           '03-clean': 'MetaLens Görüntüleyici', '04-office': 'MetaLens Görüntüleyici', '05-video-location': 'MetaLens Görüntüleyici',
           '06-dark-pdf': 'MetaLens Görüntüleyici', '07-multi-file': 'MetaLens Görüntüleyici'},
}[lang]


def font(size):
    try:
        f = ImageFont.truetype('/System/Library/Fonts/SFNS.ttf', size)
        f.set_variation_by_name('Medium')
        return f
    except Exception:
        return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', size)


def background():
    bg = Image.new('RGB', (OUT_W, OUT_H))
    d = ImageDraw.Draw(bg)
    for y in range(OUT_H):
        t = y / OUT_H
        d.line([(0, y), (OUT_W, y)], fill=(int(18 + 12 * t), int(24 + 16 * t), int(58 + 40 * t)))
    glow = Image.new('L', bg.size, 0)
    ImageDraw.Draw(glow).ellipse([OUT_W * 0.35, -OUT_H * 0.5, OUT_W * 1.2, OUT_H * 0.7], fill=90)
    bg.paste((70, 100, 240), mask=glow.filter(ImageFilter.GaussianBlur(200)))
    return bg.convert('RGBA')


def popup_composite():
    """Sayfa + sağ üstte açılır pencere (gerçek eklenti açılır penceresi gibi)."""
    page = Image.open(os.path.join(raw, '02-page.png')).convert('RGBA')
    pop = Image.open(os.path.join(raw, '02-popup.png')).convert('RGBA')
    s = page.width // 1280
    r = 12 * s
    mask = Image.new('L', pop.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, pop.width - 1, pop.height - 1], r, fill=255)
    x, y = page.width - pop.width - 16 * s, 8 * s
    shadow = Image.new('RGBA', page.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([x, y + 6 * s, x + pop.width, y + pop.height + 6 * s], r, fill=(0, 0, 0, 110))
    canvas = Image.alpha_composite(Image.alpha_composite(page, Image.new('RGBA', page.size, (0, 0, 0, 40))), shadow.filter(ImageFilter.GaussianBlur(14 * s)))
    canvas.paste(pop, (x, y), mask)
    return canvas


def frame(img, title, dark):
    img = img.convert('RGB').resize((CONTENT_W, CONTENT_H), Image.LANCZOS)
    canvas = background()
    win_w, win_h = CONTENT_W, BAR + CONTENT_H
    shadow = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([PAD, PAD + 16, PAD + win_w, PAD + win_h + 10], RADIUS, fill=(0, 0, 0, 150))
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(28)))
    win = Image.new('RGB', (win_w, win_h), (32, 34, 40) if dark else (236, 237, 240))
    d = ImageDraw.Draw(win)
    for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        cx = 26 + i * 22
        d.ellipse([cx - 7, BAR / 2 - 7, cx + 7, BAR / 2 + 7], fill=c)
    f = font(17)
    tw = d.textlength(title, font=f)
    d.text(((win_w - tw) / 2, BAR / 2 - 11), title, font=f, fill=(190, 194, 204) if dark else (92, 96, 106))
    d.line([(0, BAR - 1), (win_w, BAR - 1)], fill=(20, 22, 26) if dark else (214, 216, 222))
    win.paste(img, (0, BAR))
    mask = Image.new('L', win.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, win_w - 1, win_h - 1], RADIUS, fill=255)
    canvas.paste(win, (PAD, PAD), mask)
    return canvas.convert('RGB')


REAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'real', 'chrome-pdf-viewer.png')
if os.path.exists(REAL):  # gerçek kullanım görseli (adlar karartılmış, dil fark etmez)
    title = 'Chrome PDF viewer · real-world file' if lang == 'en' else 'Chrome PDF görüntüleyici · gerçek dosya'
    frame(Image.open(REAL), title, dark=True).save(os.path.join(out_dir, '08-real-world.png'), optimize=True)

for name, title in T.items():
    src = popup_composite() if name == '02-page-scan' else Image.open(os.path.join(raw, f'{name}.png'))
    frame(src, title, dark=name == '06-dark-pdf').save(os.path.join(out_dir, f'{name}.png'), optimize=True)
    print(name)
