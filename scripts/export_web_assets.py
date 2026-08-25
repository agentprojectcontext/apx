"""Export square blob bodies (no eyes) + a TS preset registry for the web app.
Eyes are drawn animated on top in the browser; here we only compute the eye
rects in the same 256x256 canvas the body is padded into. A preset with an
empty eye list is a 'cyclops' whose face is baked into the render (keeps its
ring/LED); it still bobs, it just doesn't blink."""
from PIL import Image
import os
import pathlib
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

presets = {}
for k, (label, color, e) in BLOBS.items():
    im = Image.open(SCRATCH / f"blob_{k}.png").convert("RGBA")
    W, H = im.size
    box = SIZE * (1 - 2 * PAD)
    sc = min(box / W, box / H)
    nw, nh = W * sc, H * sc
    offx, offy = (SIZE - nw) / 2, (SIZE - nh) / 2
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(im.resize((max(1, round(nw)), max(1, round(nh))), Image.LANCZOS), (round(offx), round(offy)))
    canvas.save(PUB / f"{k}.png")
    presets[k] = (label, f"/modules/blobs/{k}.png", color, eye_rects(W, H, sc, offx, offy, e))
    print(f"{k}: body ok, {len(presets[k][3])} eyes")

lines = [
    "// AUTO-GENERATED by scripts/export_web_assets.py — do not edit by hand.",
    "// Square blob bodies live in public/modules/blobs/<key>.png; eye rects are in the",
    "// same 256x256 canvas and are drawn animated on top by <BlobAvatar>. An empty eye",
    "// list = a 'cyclops' whose face is baked into the render (it bobs but doesn't blink).",
    "",
    "export type BlobEye = { x: number; y: number; w: number; h: number; rx: number };",
    "export type BlobPreset = { key: string; label: string; src: string; eyeColor: string; eyes: BlobEye[] };",
    "",
    "export const BLOB_VIEWBOX = 256;",
    "",
    "export const BLOB_PRESETS: Record<string, BlobPreset> = {",
]
for k, (label, src, color, eyes) in presets.items():
    ev = ", ".join(f"{{ x: {x}, y: {y}, w: {w}, h: {h}, rx: {r} }}" for (x, y, w, h, r) in eyes)
    lines.append(f'  {k}: {{ key: "{k}", label: "{label}", src: "{src}", eyeColor: "{color}", eyes: [{ev}] }},')
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
