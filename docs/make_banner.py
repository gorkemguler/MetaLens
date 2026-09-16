#!/usr/bin/env python3
"""README banner'ı üretir. Kullanım: python3 docs/make_banner.py <tr|en> <01-live-panel.png> <çıktı.png>"""
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

lang, shot_path, out = sys.argv[1:4]
S = 2
W, H = 1280 * S, 640 * S
TEXT = {
    'en': dict(tagline=['See what your files', 'reveal about you.'],
               sub='Live metadata for images, PDFs, Office documents and media —\nfind GPS, authors and hidden data, then strip it.',
               chips=['EXIF · GPS', 'PDF security', 'Office traces', 'Video location', 'Clean & download'],
               foot='Chrome · Edge · Brave   ·   Manifest V3   ·   No dependencies   ·   Nothing leaves your browser'),
    'tr': dict(tagline=['Dosyaların senin hakkında', 'ne anlatıyor, gör.'],
               sub='Resim, PDF, Office belgesi ve medya için canlı metadata —\nGPS, yazar ve gizli verileri bul, sonra temizle.',
               chips=['EXIF · GPS', 'PDF güvenliği', 'Office izleri', 'Video konumu', 'Temizle ve indir'],
               foot='Chrome · Edge · Brave   ·   Manifest V3   ·   Bağımlılık yok   ·   Veri tarayıcıdan çıkmaz'),
}[lang]


def font(size, weight='Regular'):
    try:
        f = ImageFont.truetype('/System/Library/Fonts/SFNS.ttf', size * S)
        f.set_variation_by_name(weight)
        return f
    except Exception:
        return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf' if weight == 'Bold' else '/System/Library/Fonts/Supplemental/Arial.ttf', size * S)


# arka plan: koyu lacivert degrade + nokta ızgarası
bg = Image.new('RGB', (W, H))
d = ImageDraw.Draw(bg)
for y in range(H):
    t = y / H
    d.line([(0, y), (W, y)], fill=(int(14 + 12 * t), int(19 + 16 * t), int(46 + 40 * t)))
glow = Image.new('L', (W, H), 0)
ImageDraw.Draw(glow).ellipse([W * 0.45, -H * 0.4, W * 1.3, H * 0.9], fill=110)
bg.paste((70, 100, 240), mask=glow.filter(ImageFilter.GaussianBlur(160 * S)))
d = ImageDraw.Draw(bg)
for x in range(0, W, 28 * S):
    for y in range(0, H, 28 * S):
        d.ellipse([x, y, x + S, y + S], fill=(60, 72, 120))

# logo (icons/ ile aynı çizim, büyük boyutta)
def logo(size):
    k = size / 512
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    g = ImageDraw.Draw(im)
    g.rounded_rectangle([40 * k, 40 * k, 472 * k, 472 * k], radius=96 * k, fill=(59, 91, 219, 255))
    g.rounded_rectangle([120 * k, 96 * k, 340 * k, 392 * k], radius=22 * k, fill=(255, 255, 255, 255))
    for yy in (160, 210, 260):
        g.rounded_rectangle([156 * k, yy * k, 300 * k, (yy + 22) * k], radius=11 * k, fill=(190, 200, 235, 255))
    g.ellipse([230 * k, 230 * k, 410 * k, 410 * k], outline=(255, 196, 0, 255), width=int(34 * k), fill=(255, 255, 255, 90))
    g.line([392 * k, 392 * k, 452 * k, 452 * k], fill=(255, 196, 0, 255), width=int(48 * k))
    return im

X = 72 * S
bg.paste(lg := logo(84 * S), (X - 8 * S, 70 * S), lg)
d.text((X + 88 * S, 82 * S), 'MetaLens', font=font(52, 'Bold'), fill=(255, 255, 255))
y = 196 * S
for line in TEXT['tagline']:
    d.text((X, y), line, font=font(44, 'Bold'), fill=(236, 240, 255))
    y += 54 * S
y += 14 * S
d.multiline_text((X, y), TEXT['sub'], font=font(19), fill=(170, 182, 225), spacing=8 * S)
y += 76 * S

# özellik çipleri
cx, cy = X, y
cf = font(16, 'Semibold')
for i, c in enumerate(TEXT['chips']):
    tw = d.textlength(c, font=cf)
    w = tw + 28 * S
    if cx + w > 690 * S:
        cx, cy = X, cy + 44 * S
    fill = (201, 42, 42) if i == 0 else (40, 52, 110)
    d.rounded_rectangle([cx, cy, cx + w, cy + 34 * S], radius=17 * S, fill=fill)
    d.text((cx + 14 * S, cy + 7 * S), c, font=cf, fill=(255, 255, 255))
    cx += w + 10 * S
d.text((X, H - 62 * S), TEXT['foot'], font=font(15), fill=(120, 134, 190))

# sağ: gerçek panel ekran görüntüsünden kesit
shot = Image.open(shot_path).convert('RGB')
sw = shot.width / 1280  # görüntünün piksel yoğunluğu
panel = shot.crop((int(626 * sw), int(8 * sw), int(1262 * sw), int(560 * sw)))
pw = 470 * S
panel = panel.resize((pw, int(panel.height * pw / panel.width)), Image.LANCZOS)
px, py = W - pw - 56 * S, 64 * S
visible_h = H - py - 40 * S
panel = panel.crop((0, 0, pw, min(panel.height, visible_h)))
mask = Image.new('L', panel.size, 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, panel.width - 1, panel.height - 1], 16 * S, fill=255)
fade = Image.linear_gradient('L').resize((panel.width, panel.height))
fade = fade.point(lambda v: 255 if v < 190 else int(255 * (255 - v) / 65))
mask = Image.composite(mask, Image.new('L', panel.size, 0), fade)
shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle([px, py + 14 * S, px + pw, py + panel.height], 16 * S, fill=(0, 0, 0, 150))
canvas = Image.alpha_composite(bg.convert('RGBA'), shadow.filter(ImageFilter.GaussianBlur(26 * S)))
canvas.paste(panel, (px, py), mask)
canvas.convert('RGB').save(out, optimize=True)
print(out, canvas.size)
