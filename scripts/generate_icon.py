from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
BUILD.mkdir(exist_ok=True)

scale = 4
size = 256
canvas = Image.new("RGBA", (size * scale, size * scale), (7, 11, 14, 255))
draw = ImageDraw.Draw(canvas)

draw.rounded_rectangle(
    (8 * scale, 8 * scale, 248 * scale, 248 * scale),
    radius=50 * scale,
    fill=(10, 15, 19, 255),
    outline=(38, 48, 56, 255),
    width=5 * scale,
)
draw.ellipse(
    (43 * scale, 43 * scale, 213 * scale, 213 * scale),
    outline=(117, 223, 75, 255),
    width=15 * scale,
)
draw.line(
    [(79 * scale, 131 * scale), (113 * scale, 163 * scale), (180 * scale, 91 * scale)],
    fill=(117, 223, 75, 255),
    width=18 * scale,
    joint="curve",
)

canvas = canvas.resize((size, size), Image.Resampling.LANCZOS)
canvas.save(BUILD / "icon.png")
canvas.save(
    BUILD / "icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
