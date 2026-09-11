"""Export square blob bodies (no eyes) + a TS preset registry for the web app.
Eyes are drawn animated on top in the browser; here we only compute the eye
rects in the same 256x256 canvas the body is padded into. A preset with an
empty eye list is a 'cyclops' whose face is baked into the render (keeps its
ring/LED); it still bobs, it just doesn't blink."""
from PIL import Image, ImageDraw
from io import BytesIO
import base64
import os
import pathlib
import re
import subprocess
import sys

# Repo root is the script's parent directory (scripts/ -> repo). No hardcoded
# local paths. Source crops (blob_<key>.png) are read from BLOB_SRC_DIR, which
# defaults to the current working directory but can be overridden via env.
REPO = pathlib.Path(__file__).resolve().parents[1]
PUB = REPO / "src/interfaces/web/public/modules/blobs"
TS = REPO / "src/interfaces/web/src/components/agents/blobPresets.ts"
# The key list is also needed outside the browser: the CLI, the MCP server and
# the daemon all create agents and have to assign an avatar. Only the keys —
# eye rects and sources are the renderer's business.
CORE_KEYS = REPO / "src/core/apc/blob-keys.js"
SCRATCH = pathlib.Path(os.environ.get("BLOB_SRC_DIR", "."))
SIZE = 256
PAD = 0.06
# The eyes are rounded rectangles, and drawn straight at 256 their corners come
# out stepped — which shows at the size an avatar is actually used. Drawn at 4x
# and brought down with LANCZOS, like the body already is.
FACE_SUPERSAMPLE = 4

# key: (label, eyeColor, eyes)  where eyes = (cxl, cxr, cy, ew_frac, eh_frac) | None
BLOBS = {
    # ── original 7 ──
    "menta":   ("Menta",   "#15181C", (0.51, 0.67, 0.42, 0.085, 0.15)),
    "parche":  ("Parche",  "#15181C", (0.57, 0.73, 0.4, 0.085, 0.15)),
    "trino":   ("Trino",   "#15181C", (0.44, 0.60, 0.58, 0.080, 0.14)),
    "cubi":    ("Cubi",    "#15181C", (0.42, 0.58, 0.42, 0.085, 0.15)),
    "nimbo":   ("Nimbo",   "#15181C", (0.42, 0.58, 0.42, 0.085, 0.15)),
    "papa":    ("Papa",    "#15181C", (0.53, 0.69, 0.4, 0.082, 0.14)),
    "noche":   ("Noche",   "#3AE7B0", (0.52, 0.7, 0.6, 0.085, 0.15)),
    # ── new 8 ──
    "kiwi":    ("Kiwi",    "#15181C", (0.51, 0.67, 0.37, 0.085, 0.13)),
    "gajo":    ("Gajo",    "#15181C", (0.44, 0.60, 0.42, 0.085, 0.13)),
    "campana": ("Campana", "#15181C", (0.44, 0.58, 0.38, 0.082, 0.13)),
    "cobalto": ("Cobalto", "#15181C", (0.53, 0.69, 0.42, 0.085, 0.13)),
    "rubi":    ("Rubí",    "#15181C", (0.51, 0.67, 0.37, 0.085, 0.13)),
    "trebol":  ("Trébol",  "#15181C", (0.52, 0.67, 0.53, 0.082, 0.13)),
    "saturno": ("Saturno", "#15181C", None),
    "onyx":    ("Onyx",    "#3AE7B0", (0.5, 0.67, 0.55, 0.085, 0.13)),
    # ── new 20 (eyes placed per the with-eyes reference) ──
    "perla":    ("Perla",    "#15181C", (0.5, 0.65, 0.46, 0.075, 0.095)),
    "faro":     ("Faro",     "#15181C", (0.37, 0.51, 0.42, 0.070, 0.090)),
    "brasa":    ("Brasa",    "#15181C", (0.39, 0.53, 0.38, 0.075, 0.095)),
    "aqua":     ("Aqua",     "#15181C", (0.31, 0.45, 0.494, 0.07, 0.09)),
    "coral":    ("Coral",    "#15181C", (0.4, 0.54, 0.628, 0.068, 0.085)),
    "zafiro":   ("Zafiro",   "#15181C", (0.42, 0.56, 0.496, 0.075, 0.095)),
    "pino":     ("Pino",     "#15181C", (0.52, 0.66, 0.523, 0.07, 0.09)),
    "eclipse":  ("Eclipse",  "#060709", (0.42, 0.55, 0.473, 0.07, 0.09)),
    "peon":     ("Peón",     "#15181C", (0.42, 0.56, 0.351, 0.06, 0.08)),
    "ovni":     ("Ovni",     "#15181C", (0.44, 0.58, 0.42, 0.070, 0.085)),
    "amatista": ("Amatista", "#15181C", (0.35, 0.49, 0.42, 0.075, 0.095)),
    "volcan":   ("Volcán",   "#15181C", (0.4, 0.53, 0.416, 0.065, 0.085)),
    "quad":     ("Quad",     "#15181C", (0.33, 0.63, 0.28, 0.078, 0.098)),
    "cometa":   ("Cometa",   "#15181C", (0.44, 0.58, 0.40, 0.075, 0.095)),
    "lila":     ("Lila",     "#15181C", (0.42, 0.56, 0.44, 0.070, 0.090)),
    "orbita":   ("Órbita",   "#060709", (0.43, 0.57, 0.40, 0.070, 0.085)),
    "caracol":  ("Caracol",  "#15181C", (0.63, 0.77, 0.45, 0.065, 0.085)),
    "iris":     ("Iris",     "#15181C", (0.38, 0.52, 0.45, 0.070, 0.090)),
    "laguna":   ("Laguna",   "#15181C", (0.44, 0.58, 0.33, 0.070, 0.090)),
    "carbon":   ("Carbón",   "#060709", (0.38, 0.52, 0.42, 0.075, 0.095)),
}

def eye_rects(W, H, sc, offx, offy, e):
    if e is None:
        return []
    cxl, cxr, cy, ewf, ehf = e
    ew, eh = ewf * W * sc, ehf * H * sc
    r = min(ew, eh) * 0.40
    out = []
    for cx in (cxl, cxr):
        ccx, ccy = offx + cx * W * sc, offy + cy * H * sc
        out.append((round(ccx - ew / 2, 1), round(ccy - eh / 2, 1), round(ew, 1), round(eh, 1), round(r, 1)))
    return out

def stored_eyes():
    """The eye rects already in blobPresets.ts, keyed by blob.

    Needed because the source crops are scratch inputs: they are read once, at
    the time a blob is added, and none of them are on this machine any more. For
    every blob that already exists, the rects in the generated TS are the only
    surviving record of the crop's geometry.

    They cannot be recovered from the exported body either. The crops carried
    transparent margin of their own, so the body's own bounding box lands two or
    three pixels off what was computed from the crop — a squint on most blobs
    and a visibly wrong face on `quad`.
    """
    if not TS.exists():
        return {}

    out = {}
    for line in TS.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*(\w+): \{.*eyes: \[(.*)\] \},?\s*$", line)
        if not m:
            continue
        out[m.group(1)] = [
            tuple(float(v) for v in rect)
            for rect in re.findall(
                r"x: ([\d.]+), y: ([\d.]+), w: ([\d.]+), h: ([\d.]+), rx: ([\d.]+)", m.group(2)
            )
        ]
    return out


def face_png(canvas, eyes, color):
    """The body with its eyes on, flattened.

    A still of the resting face — the animation only transforms these rects, so
    drawing them where they are is what the blob looks like when it is not
    blinking. A cyclops (no rects) already has its face in the body, so it comes
    back unchanged.

    Kept in a file of its own rather than replacing the body: <BlobAvatar> needs
    the eyeless body to animate eyes over, and overwriting it would break the
    web avatars in a way nobody sees until they look at one.
    """
    if not eyes:
        return canvas.copy()

    sup = FACE_SUPERSAMPLE
    big = canvas.resize((SIZE * sup, SIZE * sup), Image.LANCZOS)
    draw = ImageDraw.Draw(big)

    for (x, y, w, h, rx) in eyes:
        draw.rounded_rectangle(
            [x * sup, y * sup, (x + w) * sup, (y + h) * sup], radius=rx * sup, fill=color
        )

    return big.resize((SIZE, SIZE), Image.LANCZOS)


def standalone_svg(canvas, eyes, color):
    """The same blob as an SVG somebody can animate.

    Self-contained, body embedded as a data URI. That is the whole point of it:
    an SVG that references the body beside it offers nothing `blobPresets.ts`
    does not already give the web app, and the consumers this exists for —
    anything outside the browser that wants an agent's face — cannot resolve a
    relative href. It costs about 60KB a blob, which is the price of the file
    being useful on its own.

    The body is embedded already padded into the 256 canvas, so these
    coordinates are the ones in BLOB_VIEWBOX and in `eyes` — one coordinate
    system, no placement maths to repeat and get subtly wrong.
    """
    buffer = BytesIO()
    canvas.save(buffer, format="PNG")
    body = base64.b64encode(buffer.getvalue()).decode("ascii")

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" width="{SIZE}" height="{SIZE}">',
        f'  <image href="data:image/png;base64,{body}" x="0" y="0" width="{SIZE}" height="{SIZE}"/>',
    ]
    for (x, y, w, h, rx) in eyes:
        out.append(f'  <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{color}"/>')
    out.append("</svg>")

    return "\n".join(out) + "\n"


known_eyes = stored_eyes()

presets = {}
for k, (label, color, e) in BLOBS.items():
    crop = SCRATCH / f"blob_{k}.png"
    body = PUB / f"{k}.png"

    if crop.exists():
        # The crop is on hand, so everything comes off it: the body, and the eye
        # rects in the canvas it is padded into. This is the path a NEW blob
        # takes, and it stays the only place geometry is computed.
        im = Image.open(crop).convert("RGBA")
        W, H = im.size
        box = SIZE * (1 - 2 * PAD)
        sc = min(box / W, box / H)
        nw, nh = W * sc, H * sc
        offx, offy = (SIZE - nw) / 2, (SIZE - nh) / 2
        canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        canvas.alpha_composite(im.resize((max(1, round(nw)), max(1, round(nh))), Image.LANCZOS), (round(offx), round(offy)))
        canvas.save(body)
        eyes = eye_rects(W, H, sc, offx, offy, e)
        origin = "crop"
    elif body.exists():
        # No crop, which is every existing blob: they were read once, when the
        # blob was added, and are not kept. The exported body IS the canvas and
        # the rects in blobPresets.ts are the geometry — see stored_eyes(). The
        # body is left exactly as it is; re-padding it would shrink the blob by
        # another 6% and drag the eyes with it.
        canvas = Image.open(body).convert("RGBA")
        eyes = known_eyes.get(k)
        if eyes is None:
            sys.exit(f"{k}: no crop in {SCRATCH} and no eyes in {TS.name}. Add blob_{k}.png and run again.")
        origin = "body"
    else:
        sys.exit(f"{k}: nothing to build from. Put blob_{k}.png in {SCRATCH} (or set BLOB_SRC_DIR).")

    # Two more outputs per blob, and both are additions: the body above is
    # untouched by either. One is a still anything can show; the other is the
    # same blob as something anything can animate.
    face_png(canvas, eyes, color).save(PUB / f"{k}.face.png")
    (PUB / f"{k}.svg").write_text(standalone_svg(canvas, eyes, color), encoding="utf-8")

    presets[k] = (
        label,
        f"/modules/blobs/{k}.png",
        f"/modules/blobs/{k}.face.png",
        f"/modules/blobs/{k}.svg",
        color,
        eyes,
    )
    print(f"{k}: {origin} ok, {len(eyes)} eyes, +face +svg")

lines = [
    "// AUTO-GENERATED by scripts/export_web_assets.py — do not edit by hand.",
    "// Square blob bodies live in public/modules/blobs/<key>.png; eye rects are in the",
    "// same 256x256 canvas and are drawn animated on top by <BlobAvatar>. An empty eye",
    "// list = a 'cyclops' whose face is baked into the render (it bobs but doesn't blink).",
    "//",
    "// `face` and `svg` are the same blob for everything that is not <BlobAvatar>: a",
    "// flat PNG with the resting face on it, and a self-contained SVG carrying the body",
    "// and the rects, for a consumer that wants to animate it itself. Both are written",
    "// by the same export, so a new blob arrives with all three or with none.",
    "",
    "export type BlobEye = { x: number; y: number; w: number; h: number; rx: number };",
    "export type BlobPreset = {",
    "  key: string;",
    "  label: string;",
    "  /** The eyeless body. What <BlobAvatar> draws animated eyes over. */",
    "  src: string;",
    "  /** The body with its eyes on, flattened. For anything that just needs a picture. */",
    "  face: string;",
    "  /** Body and eyes in one standalone file, for a consumer that renders SVG. */",
    "  svg: string;",
    "  eyeColor: string;",
    "  eyes: BlobEye[];",
    "};",
    "",
    "export const BLOB_VIEWBOX = 256;",
    "",
    "export const BLOB_PRESETS: Record<string, BlobPreset> = {",
]
for k, (label, src, face, svg, color, eyes) in presets.items():
    ev = ", ".join(f"{{ x: {x}, y: {y}, w: {w}, h: {h}, rx: {r} }}" for (x, y, w, h, r) in eyes)
    lines.append(
        f'  {k}: {{ key: "{k}", label: "{label}", src: "{src}", face: "{face}", svg: "{svg}", '
        f'eyeColor: "{color}", eyes: [{ev}] }},'
    )
lines += [
    "};",
    "",
    "export const BLOB_KEYS = Object.keys(BLOB_PRESETS);",
    "export function isBlobKey(v?: string | null): v is string { return !!v && v in BLOB_PRESETS; }",
    "",
]
TS.write_text("\n".join(lines), encoding="utf-8")
print("wrote", TS, "with", len(presets), "presets")

core_lines = [
    "// AUTO-GENERATED by scripts/export_web_assets.py — do not edit by hand.",
    "// Blob avatar preset keys, for the non-browser surfaces that create agents",
    "// (CLI, MCP server, daemon API). The renderer's copy — with eye rects and",
    "// image sources — is src/interfaces/web/src/components/agents/blobPresets.ts.",
    "",
    "export const BLOB_KEYS = Object.freeze([",
]
core_lines += [f'  "{k}",' for k in presets]
core_lines += ["]);", ""]
CORE_KEYS.write_text("\n".join(core_lines), encoding="utf-8")
print("wrote", CORE_KEYS, "with", len(presets), "keys")

# Keep the native mascot's bundled bodies and eye geometry in the same export
# transaction so adding a web preset cannot silently leave Android behind.
subprocess.run([sys.executable, str(REPO / "scripts/export_android_mascot_assets.py")], check=True)
