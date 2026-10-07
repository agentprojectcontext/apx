"""Export the shared web blob bodies to a small terminal atlas (Pillow, generation only)."""
import json
import re
import base64
import zlib
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
atlas = {}
catalog = (root / "packages/ui/src/blobs/catalog.ts").read_text()
for body in sorted((root / "packages/ui/src/blobs/bodies").glob("*.webp")):
    image = Image.open(body).convert("RGBA")
    eye_mask = Image.new("L", image.size)
    eye_draw = ImageDraw.Draw(eye_mask)
    face_draw = ImageDraw.Draw(image)
    block = re.search(r"  " + re.escape(body.stem) + r": \{(.*?)    src:", catalog, re.S)
    if block:
        for x, y, w, h, radius in re.findall(r"x: ([\d.]+), y: ([\d.]+), w: ([\d.]+), h: ([\d.]+), rx: ([\d.]+)", block.group(1)):
            scale = image.width / 256
            x, y, w, h, radius = [float(v) * scale for v in (x, y, w, h, radius)]
            eye_draw.rounded_rectangle((x, y, x + w, y + h), radius=radius, fill=255)
            eye_color = re.search(r'eyeColor: "(#[0-9A-Fa-f]{6})"', block.group(1))
            face_draw.rounded_rectangle((x, y, x + w, y + h), radius=radius, fill=eye_color.group(1) if eye_color else "#15181c")
    bounds = image.getchannel("A").getbbox()
    eye_mask = eye_mask.crop(bounds).resize((26, 13), Image.Resampling.LANCZOS)
    full = image.crop(bounds).resize((26, 26), Image.Resampling.LANCZOS)
    compressed = base64.b64encode(zlib.compress(full.tobytes(), 9)).decode()
    image = image.crop(bounds).resize((26, 13), Image.Resampling.LANCZOS)
    rows = []
    for y in range(image.height):
        row = ""
        for x in range(image.width):
            r, g, b, a = image.getpixel((x, y))
            row += " " if a < 90 else "█" if eye_mask.getpixel((x, y)) > 60 else "▒"
        rows.append(row.rstrip())
    pixels = [(r, g, b) for r, g, b, a in image.getdata() if a > 200]
    color = [round(sum(p[i] for p in pixels) / max(1, len(pixels))) for i in range(3)]
    atlas[body.stem] = {"rows": rows, "color": color, "pixels": compressed}
(root / "apps/terminal/src/blobs.json").write_text(json.dumps(atlas, indent=2) + "\n")
