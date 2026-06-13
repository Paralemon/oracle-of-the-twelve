"""Generate og-image.png (1200x630) — the social-share card.

Dark ink background, a gold ring echoing the dice arena, three glyphs
(planet / sign / house) above the title. Run from the repo root:

    ./venv/bin/python scripts/make_og_image.py
"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
INK = (11, 11, 20)
GOLD = (217, 177, 90)
GOLD_BRIGHT = (247, 217, 137)
PARCHMENT = (233, 227, 210)

img = Image.new("RGB", (W, H), INK)
d = ImageDraw.Draw(img)

# Soft radial warmth behind the center, drawn as concentric alpha ellipses.
glow = Image.new("L", (W, H), 0)
gd = ImageDraw.Draw(glow)
for i in range(60, 0, -1):
    r = i * 7
    gd.ellipse([W/2 - r*1.6, H/2 - r, W/2 + r*1.6, H/2 + r], fill=int(38 * (1 - i/60)))
img = Image.composite(Image.new("RGB", (W, H), (26, 21, 16)), img, glow)
d = ImageDraw.Draw(img)

# Gold ring, echoing the dice arena.
cx, cy, R = W // 2, 295, 268
for w, col in [(7, GOLD), (2, GOLD_BRIGHT)]:
    d.ellipse([cx - R, cy - R * 0.46, cx + R, cy + R * 0.46], outline=col, width=w)

symbols = ImageFont.truetype("/System/Library/Fonts/Apple Symbols.ttf", 110)
title_f = ImageFont.truetype("/System/Library/Fonts/Supplemental/Georgia.ttf", 64)
sub_f = ImageFont.truetype("/System/Library/Fonts/Supplemental/Georgia Italic.ttf", 30)

# Three glyphs inside the ring: Venus, Scorpio, 5 (the canonical example cast).
glyphs = "♀   ♏   5"
bbox = d.textbbox((0, 0), glyphs, font=symbols)
d.text((cx - (bbox[2] - bbox[0]) / 2, cy - (bbox[3] - bbox[1]) / 2 - bbox[1]),
       glyphs, font=symbols, fill=GOLD_BRIGHT)

title = "ORACLE OF THE TWELVE"
# Letter-spaced title.
spaced = " ".join(title)
bbox = d.textbbox((0, 0), spaced, font=title_f)
d.text((cx - (bbox[2] - bbox[0]) / 2, 452), spaced, font=title_f, fill=GOLD)

sub = "Cast three twelve-sided dice — planet, sign, and house — and receive your reading."
bbox = d.textbbox((0, 0), sub, font=sub_f)
d.text((cx - (bbox[2] - bbox[0]) / 2, 545), sub, font=sub_f, fill=PARCHMENT + (200,) if False else (170, 165, 150))

img.save("og-image.png", optimize=True)
print("wrote og-image.png", img.size)
