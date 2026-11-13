"""
Region Genie: the Region Genie node (formerly "Color Map to Layout")

Draw regions on the node's layered canvas (shapes and paint; each layer belongs to a region
with a color, type and prompt), or feed in a color map image, and get:
  - color_map         flat color region map (for MOSS-Image Color/Depth Control)
  - masks             one exact mask per region (any shape)
  - bboxes            tight pixel bbox per region  -> MOSS-Image Prompt Builder KJ, Create Bounding Boxes, BBoxes to Masks
  - elements          elements with prompts -> MOSS-Image Layout Prompt, Create Bounding Boxes, BBoxes to Masks
  - prompt            the prompt as text, in the format the model takes (picked automatically, or set with the
                      node's "format" control): MOSS-Image layout JSON, Ideogram 4 caption JSON, or plain text
                      (scene, background, region prompts) for Krea 2, Flux, Anima, SDXL and other models

The canvas is stored as vector data (paint_data), so it follows width/height. Python
re-renders it at the real size with hard edges and stacks the layers, so every pixel belongs
to exactly one region (or none). paint_data v1 (single-layer canvases) is still rendered.
"""

import colorsys
import json
import logging
import math
import re

import numpy as np
import torch
from PIL import Image, ImageDraw

LOG = "[Region Genie]"
MAX_REGIONS = 255

IMAGE_MODES = ["backdrop (trace over)", "use as color map"]
IMPORT_MODES = ["ask before replacing", "always replace"]
LAYOUT_FORMAT = "region_genie_layout"

# distinct, saturated region-ID colors (none near black); the JS editor uses the same list
PALETTE = [
    "#E6194B", "#3CB44B", "#FFE119", "#4363D8", "#F58231", "#911EB4", "#42D4F4", "#F032E6",
    "#BFEF45", "#FABED4", "#469990", "#DCBEFF", "#9A6324", "#FFFAC8", "#800000", "#AAFFC3",
    "#808000", "#FFD8B1", "#000075", "#A9A9A9", "#FFFFFF", "#00FF7F", "#FF4500", "#1E90FF",
]


def _hex_to_rgb(h):
    h = str(h).strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    try:
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return None


def _rgb_to_hex(rgb):
    return "#{:02X}{:02X}{:02X}".format(*(int(v) for v in rgb))


# --------------------------------------------------------------------------- #
# color palettes (MOSS "palette" / Ideogram "color_palette"); the JS editor has the same rules
# --------------------------------------------------------------------------- #
PALETTE_MAX = 5
_PAL_MIN_DIST2 = 40 * 40          # squared RGB distance that keeps two region colors apart on the canvas


def norm_palette(p):
    """Up to 5 colors as "#RRGGBB" (upper case); anything else is dropped."""
    out = []
    for c in p if isinstance(p, (list, tuple)) else []:
        if not isinstance(c, str):
            continue
        h = c.strip().upper()
        if not h.startswith("#"):
            h = "#" + h
        if re.fullmatch(r"#[0-9A-F]{6}", h):
            out.append(h)
        if len(out) >= PALETTE_MAX:
            break
    return out


def active_palette(region):
    """A region's palette when it is switched on, else []."""
    return norm_palette(region.get("palette")) if region.get("paletteOn") else []


def _distinct_color(c, taken):
    far = lambda q: all((q[0] - t[0]) ** 2 + (q[1] - t[1]) ** 2 + (q[2] - t[2]) ** 2 >= _PAL_MIN_DIST2
                        for t in taken)
    if far(c):
        return c
    for k in range(1, 22):                     # lighter / darker versions of the same color first
        for sign in (1, -1):
            d = 12 * k * sign
            q = [min(255, max(0, v + d)) for v in c]
            if max(q) >= 32 and far(q):
                return q
    q, n, tk = list(c), 0, {tuple(t) for t in taken}
    while tuple(q) in tk and n < 512:          # crowded: at least keep it unique
        n += 1
        q[2] = q[2] + 1 if q[2] < 255 else q[2] - 1
        if n % 2:
            q[1] = q[1] + 1 if q[1] < 255 else q[1] - 1
    return q


def effective_colors(regions):
    """{region id: "#RRGGBB"} for regions with a palette: its first color shows the region (canvas, list and
    color_map), moved a little when it would look like black or another region's color. Regions without a
    palette keep their own colors, which are reserved first; then the palette regions in list order."""
    taken = [(0, 0, 0)]
    for r in regions:
        if not active_palette(r):
            c = _hex_to_rgb(r.get("color", ""))
            if c and len(c) == 3:
                taken.append(tuple(c))
    out = {}
    for r in regions:
        pal = active_palette(r)
        if not pal:
            continue
        c = list(_hex_to_rgb(pal[0]))
        m = max(c)
        if m < 32:
            c = [v + 32 - m for v in c]
        c = _distinct_color(c, taken)
        taken.append(tuple(c))
        out[r.get("id")] = _rgb_to_hex(c)
    return out


def _extra_color(i):
    """Colors beyond the fixed palette: golden-ratio hues."""
    h = (i * 0.618033988749895) % 1.0
    r, g, b = colorsys.hsv_to_rgb(h, 0.85, 0.95)
    return _rgb_to_hex((r * 255, g * 255, b * 255))


def parse_paint_data(text):
    try:
        data = json.loads(text) if isinstance(text, str) and text.strip() else {}
    except (ValueError, TypeError):
        logging.warning(f"{LOG} paint_data is not valid JSON; starting from an empty canvas")
        data = {}
    if not isinstance(data, dict):
        data = {}
    regions = [r for r in data.get("regions", []) if isinstance(r, dict) and "id" in r]
    ops = [o for o in data.get("ops", []) if isinstance(o, dict)]
    layers = [l for l in data.get("layers", []) if isinstance(l, dict)] if "layers" in data else None
    return regions, ops, layers


# --------------------------------------------------------------------------- #
# rendering
# --------------------------------------------------------------------------- #
def _pts(points, width, height):
    out = []
    for p in points or []:
        if isinstance(p, (list, tuple)) and len(p) >= 2:
            try:
                out.append((float(p[0]) * width, float(p[1]) * height))
            except (TypeError, ValueError):
                pass
    return out


def render_ops(index_img, ops, id_to_index, width, height):
    """Replay canvas operations onto an 'L' index image (0 = unspecified)."""
    draw = ImageDraw.Draw(index_img)
    short = min(width, height)
    kinds = [op.get("t") for op in ops]
    if "clear" in kinds:                               # "Clear" hides everything painted before it
        ops = ops[len(kinds) - 1 - kinds[::-1].index("clear") + 1:]
    for op in ops:
        kind = op.get("t")
        rid = op.get("r", 0)
        if rid == 0:
            value = 0                                  # eraser
        elif rid in id_to_index:
            value = id_to_index[rid]
        else:
            continue                                   # region was deleted
        pts = _pts(op.get("p"), width, height)
        if not pts:
            continue
        if kind == "stroke":
            diam = max(1.0, float(op.get("s", 0.02)) * short)
            rad = diam / 2.0
            if len(pts) > 1:
                draw.line(pts, fill=value, width=max(1, int(round(diam))))
            for x, y in pts:                           # round caps and joints, like the canvas preview
                draw.ellipse((x - rad, y - rad, x + rad, y + rad), fill=value)
        elif kind == "poly" and len(pts) >= 3:
            draw.polygon(pts, fill=value)
    return index_img


# --------------------------------------------------------------------------- #
# layered canvas (paint_data v2)
#
# A layer has an optional base shape in a box of bw x bh "L units" (1 L = the image's shorter
# side), its own strokes/fills/erasures in the same local units, and a transform: scale (sx, sy),
# rotation rot (degrees, clockwise on screen) and centre (ox, oy): an offset from the image centre in L units,
# so a new width/height keeps every layer in place relative to the image centre and to each other.
#   image_px = C + R(rot) * ((l - (bw/2, bh/2)) * (sx, sy) * short),  C = (W/2 + ox * short, H/2 + oy * short)
# Older data stored the centre as fractions (cx, cy) of width/height; see layer_centre().
# Layers are drawn bottom to top; each one is rendered on its own, so covered parts still exist.
# --------------------------------------------------------------------------- #
def shape_verts(kind, sides=5, bw=1.0, bh=1.0, radius=20):
    """Unit-box (0..1) outline of a base shape; mirrored in the JS editor. Rounded rectangle: bw x bh is the
    box (L units) and radius the corner radius in % of its shorter side, so corners stay round."""
    if kind == "rect":
        return [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    if kind == "roundrect":
        bw, bh = max(_f(bw, 1.0), 1e-9), max(_f(bh, 1.0), 1e-9)
        r = max(0.0, min(50.0, _f(radius, 20.0))) / 100.0 * min(bw, bh)
        if r <= 0:
            return [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
        rx, ry, n, out = r / bw, r / bh, 8, []
        for cx, cy, a0 in ((1 - rx, ry, -90), (1 - rx, 1 - ry, 0), (rx, 1 - ry, 90), (rx, ry, 180)):
            for i in range(n + 1):
                a = math.radians(a0 + 90 * i / n)
                out.append((cx + rx * math.cos(a), cy + ry * math.sin(a)))
        return out
    if kind == "ellipse":
        n = 128
        return [(0.5 + 0.5 * math.cos(2 * math.pi * i / n), 0.5 + 0.5 * math.sin(2 * math.pi * i / n)) for i in range(n)]
    if kind == "triangle":
        return [(0.5, 0.0), (1.0, 1.0), (0.0, 1.0)]
    if kind == "heart":
        n = 128
        pts = []
        for i in range(n):
            t = 2 * math.pi * i / n
            pts.append((16 * math.sin(t) ** 3,
                        -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))))
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        return [((x - x0) / (x1 - x0), (y - y0) / (y1 - y0)) for x, y in pts]
    if kind in ("pentagon", "hexagon"):
        kind, sides = "polygon", 5 if kind == "pentagon" else 6
    n = max(3, min(64, int(sides or 5)))
    if kind == "polygon":
        return [(0.5 + 0.5 * math.cos(-math.pi / 2 + 2 * math.pi * i / n),
                 0.5 + 0.5 * math.sin(-math.pi / 2 + 2 * math.pi * i / n)) for i in range(n)]
    if kind == "star":
        pts = []
        for i in range(2 * n):
            r = 0.5 if i % 2 == 0 else 0.2
            a = -math.pi / 2 + math.pi * i / n
            pts.append((0.5 + r * math.cos(a), 0.5 + r * math.sin(a)))
        return pts
    return []


def _f(v, default):
    try:
        v = float(v)
        return v if math.isfinite(v) else default
    except (TypeError, ValueError):
        return default


def _layer_params(layer, width, height):
    short = float(min(width, height))
    bw = max(1e-6, _f(layer.get("bw"), width / short))
    bh = max(1e-6, _f(layer.get("bh"), height / short))
    sx = max(1e-6, _f(layer.get("sx"), 1.0))
    sy = max(1e-6, _f(layer.get("sy"), 1.0))
    th = math.radians(_f(layer.get("rot"), 0.0))
    ox, oy = layer_centre(layer, width, height)
    cx = width / 2.0 + ox * short
    cy = height / 2.0 + oy * short
    return short, bw, bh, sx, sy, th, cx, cy


def layer_centre(layer, width, height):
    """(ox, oy): the layer's centre as an offset from the image centre in shorter-side units. Older layers
    have (cx, cy) as fractions of width/height instead, converted with the size they were made for."""
    if layer.get("ox") is not None or layer.get("oy") is not None:
        return _f(layer.get("ox"), 0.0), _f(layer.get("oy"), 0.0)
    short = float(max(1, min(width, height)))
    return (_f(layer.get("cx"), 0.5) - 0.5) * width / short, (_f(layer.get("cy"), 0.5) - 0.5) * height / short


def _local_points(points):
    out = []
    for p in points or []:
        if isinstance(p, (list, tuple)) and len(p) >= 2:
            x, y = _f(p[0], None), _f(p[1], None)
            if x is not None and y is not None:
                out.append((x, y))
    return out


def decode_runs(runs, w, h):
    """Run-length mask (alternating 0/1 runs, starting with 0) -> (h, w) uint8."""
    flat = np.zeros(w * h, np.uint8)
    pos, val = 0, 0
    for r in runs or []:
        try:
            r = int(r)
        except (TypeError, ValueError):
            break
        if r > 0:
            if val:
                flat[pos:pos + r] = 1
            pos += r
        val ^= 1
    return flat.reshape(h, w)


def layer_mask(layer, width, height):
    """Boolean (H, W) mask of one layer at the output size, hard-edged."""
    short, bw, bh, sx, sy, th, cx, cy = _layer_params(layer, width, height)
    cos, sin = math.cos(th), math.sin(th)
    shape = layer.get("shape")
    verts = [(u * bw, v * bh) for u, v in shape_verts(shape, layer.get("sides", 5), bw, bh, layer.get("radius", 20))] if shape else []
    ops = [o for o in layer.get("ops", []) if isinstance(o, dict) and o.get("t") in ("stroke", "poly", "bitmap")]

    def to_img(lx, ly):
        dx, dy = (lx - bw / 2) * sx * short, (ly - bh / 2) * sy * short
        return (cx + cos * dx - sin * dy, cy + sin * dx + cos * dy)

    if not ops:                                      # plain shape: polygon straight in image space
        img = Image.new("L", (width, height), 0)
        if len(verts) >= 3:
            ImageDraw.Draw(img).polygon([to_img(x, y) for x, y in verts], fill=1)
        return np.asarray(img) > 0

    # shape + strokes: draw in the layer's own (unrotated) raster, then warp into place
    xs, ys = [], []
    if verts:
        xs += [0.0, bw]; ys += [0.0, bh]
    for o in ops:
        if o.get("t") == "bitmap":
            xs += [_f(o.get("x0"), 0.0), _f(o.get("x1"), 0.0)]; ys += [_f(o.get("y0"), 0.0), _f(o.get("y1"), 0.0)]
            continue
        pts = _local_points(o.get("p"))
        r = max(0.0, _f(o.get("d"), 0.02)) / 2 if o.get("t") == "stroke" else 0.0
        for x, y in pts:
            xs += [x - r, x + r]; ys += [y - r, y + r]
    if not xs:
        return np.zeros((height, width), bool)
    ex0, ex1, ey0, ey1 = min(xs), max(xs), min(ys), max(ys)
    res = short * max(sx, sy)                        # raster px per L unit ~ output resolution
    span = max(ex1 - ex0, ey1 - ey0, 1e-6)
    res = min(res, 8192.0 / span)
    rw = max(1, int(math.ceil((ex1 - ex0) * res)) + 2)
    rh = max(1, int(math.ceil((ey1 - ey0) * res)) + 2)
    local = Image.new("L", (rw, rh), 0)
    d = ImageDraw.Draw(local)
    tr = lambda x, y: ((x - ex0) * res + 1, (y - ey0) * res + 1)
    if len(verts) >= 3:
        d.polygon([tr(x, y) for x, y in verts], fill=1)
    for o in ops:
        val = 0 if o.get("e") else 1
        if o.get("t") == "bitmap":
            bw_, bh_ = int(_f(o.get("w"), 0)), int(_f(o.get("h"), 0))
            if bw_ <= 0 or bh_ <= 0:
                continue
            bmp = Image.fromarray(decode_runs(o.get("runs"), bw_, bh_) * 255, "L")
            ax, ay = tr(_f(o.get("x0"), 0.0), _f(o.get("y0"), 0.0))
            bx, by = tr(_f(o.get("x1"), 0.0), _f(o.get("y1"), 0.0))
            tw, th = max(1, int(round(bx - ax))), max(1, int(round(by - ay)))
            local.paste(val, (int(round(ax)), int(round(ay))), bmp.resize((tw, th), Image.NEAREST))
            continue
        pts = [tr(x, y) for x, y in _local_points(o.get("p"))]
        if not pts:
            continue
        if o.get("t") == "stroke":
            diam = max(1.0, _f(o.get("d"), 0.02) * res)
            rad = diam / 2
            if len(pts) > 1:
                d.line(pts, fill=val, width=max(1, int(round(diam))))
            for x, y in pts:
                d.ellipse((x - rad, y - rad, x + rad, y + rad), fill=val)
        elif len(pts) >= 3:
            d.polygon(pts, fill=val)
    # output (x, y) -> local raster: inverse of the layer transform
    ka, kb = res / (sx * short), res / (sy * short)
    a, b = ka * cos, ka * sin
    c = ka * (-(cos * cx + sin * cy)) + res * (bw / 2 - ex0) + 1
    dd, e = -kb * sin, kb * cos
    f = kb * (sin * cx - cos * cy) + res * (bh / 2 - ey0) + 1
    warped = local.transform((width, height), Image.AFFINE, (a, b, c, dd, e, f),
                             resample=Image.NEAREST, fillcolor=0)
    return np.asarray(warped) > 0


def render_layers(base_idx, layers, id_to_index):
    """Composite layers bottom to top over base_idx; region 0 / 'none' = unspecified."""
    idx = np.array(base_idx, copy=True)
    h, w = idx.shape
    for layer in layers:
        if layer.get("visible") is False:
            continue
        rid = layer.get("region")
        if rid in (0, None, "none"):
            value = 0
        elif rid in id_to_index:
            value = id_to_index[rid]
        else:
            continue                                  # region deleted
        m = layer_mask(layer, w, h)
        idx[m] = value
    return idx


def quantize_image(image_np, min_pixels, merge_dist=24, blend_tol=40):
    """(H, W, 3) uint8 -> (index map (H, W) uint8 with 0 = black/unspecified, list of hex colors).

    A region color is one that forms flat areas: at least min_pixels pixels whose 4 neighbours
    have the same color (colors are compared in bins of 8 so JPEG noise still counts as flat).
    Blended edges are gradients with no flat pixels, so they never become regions; every pixel
    that isn't a region color goes to the nearest region color or to black."""
    h, w, _ = image_np.shape
    rgb = image_np.astype(np.int32)
    bins = rgb // 8
    key = (bins[..., 0] << 10) | (bins[..., 1] << 5) | bins[..., 2]
    flat = np.zeros((h, w), bool)
    if h > 2 and w > 2:
        c = key[1:-1, 1:-1]
        flat[1:-1, 1:-1] = ((c == key[:-2, 1:-1]) & (c == key[2:, 1:-1]) &
                            (c == key[1:-1, :-2]) & (c == key[1:-1, 2:]))
    fkeys = key[flat]
    if fkeys.size == 0:
        return np.zeros((h, w), np.uint8), []
    uk, counts = np.unique(fkeys, return_counts=True)
    order = np.argsort(-counts, kind="stable")
    frgb = rgb[flat]
    centers = []
    for j in order:
        if counts[j] < max(1, min_pixels) or len(centers) >= MAX_REGIONS:
            break
        sel = frgb[fkeys == uk[j]]
        packed = (sel[:, 0] << 16) | (sel[:, 1] << 8) | sel[:, 2]
        vals, cnt = np.unique(packed, return_counts=True)
        top = int(vals[cnt.argmax()])                       # most common exact color in this bin
        col = np.array([(top >> 16) & 255, (top >> 8) & 255, top & 255], np.int32)
        if col.max() < 24:                                  # near black = unspecified
            continue
        if any(((col - c) ** 2).sum() < merge_dist ** 2 for c in centers):
            continue
        centers.append(col)
    if not centers:
        return np.zeros((h, w), np.uint8), []
    cand = np.concatenate([np.zeros((1, 3), np.int32), np.stack(centers)], axis=0)   # 0 = black
    packed = (rgb[..., 0] << 16) | (rgb[..., 1] << 8) | rgb[..., 2]
    uniq, inverse = np.unique(packed.reshape(-1), return_inverse=True)
    urgb = np.stack([(uniq >> 16) & 255, (uniq >> 8) & 255, uniq & 255], axis=1)
    d2 = ((urgb[:, None, :] - cand[None, :, :]) ** 2).sum(axis=2)
    two = np.argsort(d2, axis=1)[:, :2] if len(cand) > 1 else np.zeros((len(urgb), 2), np.int64)
    nearest = two[:, 0]
    # A blended edge pixel lies between its two nearest colors; a stray speck of some other
    # color doesn't. Specks become unspecified instead of stretching a region's bbox.
    a, b = cand[two[:, 0]].astype(np.float64), cand[two[:, 1]].astype(np.float64)
    ab = b - a
    t = np.clip(((urgb - a) * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-9), 0.0, 1.0)
    seg_dist = np.sqrt(((urgb - (a + t[:, None] * ab)) ** 2).sum(1))
    nearest = np.where(seg_dist <= blend_tol, nearest, 0).astype(np.uint8)
    return nearest[inverse].reshape(h, w), [_rgb_to_hex(c) for c in centers]


def _match_color(hexc, color_to_index, tol=24):
    """Index of an existing region with this color (or a very close one), else None."""
    if hexc in color_to_index:
        return color_to_index[hexc]
    rgb = np.array(_hex_to_rgb(hexc))
    best, best_d = None, tol * tol
    for other, k in color_to_index.items():
        d = ((rgb - np.array(_hex_to_rgb(other))) ** 2).sum()
        if d < best_d:
            best, best_d = k, d
    return best


def _grid(v, size):
    return int(max(0, min(1000, round(v * 1000.0 / size))))


def _moss_bbox(grid_bbox, width, height):
    """0-1000 [y0, x0, y1, x1] -> pixels from the canvas centre, exactly as MOSS-Image Layout Prompt does it,
    so the MOSS JSON prompt is identical to that node's output for the same elements and size."""
    y0, x0, y1, x1 = grid_bbox
    return [math.floor(round(y0 * height / 1000, 9)) - height // 2, math.floor(round(x0 * width / 1000, 9)) - width // 2,
            math.ceil(round(y1 * height / 1000, 9)) - height // 2, math.ceil(round(x1 * width / 1000, 9)) - width // 2]


# --------------------------------------------------------------------------- #
# layout import
# --------------------------------------------------------------------------- #
def _paint_feather(paint_data):
    """The shared ('linked') feather of the region masks, in pixels."""
    try:
        d = json.loads(paint_data) if isinstance(paint_data, str) and paint_data.strip() else {}
        return max(0, int(round(float(d.get("feather", 0) or 0)))) if isinstance(d, dict) else 0
    except (ValueError, TypeError):
        return 0


def _region_feather(row, feather_all):
    if row.get("featherLinked", True):
        return feather_all
    try:
        return max(0, int(round(float(row.get("feather") or 0))))
    except (TypeError, ValueError):
        return 0


def _value_spans(text, after, key, values):
    """(start, end) of each string value (inside its quotes) of `key` in JSON text written by json.dumps
    (compact or default separators), searched in order from the first `after`; None where not found."""
    out = []
    pos = max(0, text.find(after))                     # after the summary (its caption may be the same text)
    for v in values:
        enc = json.dumps(v, ensure_ascii=False)
        best = None
        for head in (f'"{key}":', f'"{key}": '):
            at = text.find(head + enc, pos)
            if at >= 0 and (best is None or at < best[0]):
                best = (at, head)
        if best is None:
            out.append(None)
            continue
        a = best[0] + len(best[1]) + 1
        b = a + len(enc) - 2
        out.append((a, b))
        pos = b
    return out


def caption_char_spans(moss_text, items):
    """(start, end) of each item's caption string inside moss_text (MOSS layout JSON), or None."""
    return _value_spans(moss_text, '"items":', "caption", [it.get("caption", "") for it in items])


def ideogram_desc_spans(ideogram_text, elements):
    """(start, end) of each element's desc string inside ideogram_text (Ideogram caption JSON), or None."""
    return _value_spans(ideogram_text, '"elements":', "desc", [e.get("desc", "") for e in elements])


def plain_prompt(scene, prompts):
    """A natural-language prompt: the scene, then each region's prompt as its own sentence (for models without a
    layout format, e.g. Krea 2). Returns (text, [(start, end) of each region's prompt or None])."""
    out, spans = str(scene or "").strip(), []
    for p in prompts:
        p = str(p or "").strip()
        if not p:
            spans.append(None)
            continue
        base = out.rstrip()
        sep = ". " if base and not base.endswith((".", "!", "?")) else (" " if base else "")
        start = len(base) + len(sep)
        out = base + sep + p
        spans.append((start, len(out)))
    return out, spans


def ideogram_notes(scene, background, elements):
    """Hints from Ideogram's JSON prompting guide, for the region_info of an Ideogram 4 run."""
    out = []
    if not scene:
        out.append("NOTE (Ideogram 4): scene_prompt_positive is empty, so high_level_description (required) is made "
                   "from the region prompts; one or two sentences about the whole image work better")
    elif len(scene.split()) > 50:
        out.append("NOTE (Ideogram 4): Ideogram suggests keeping high_level_description (scene_prompt_positive) under "
                   "50 words")
    if not background:
        out.append("NOTE (Ideogram 4): scene_prompt_background is empty; Ideogram 4 expects a background description "
                   "(ground, floor and sky belong there, not in a region)")
    if len(elements) > 5:
        out.append(f"NOTE (Ideogram 4): {len(elements)} regions; Ideogram suggests 5 or fewer elements per image")
    long_text = [i for i, e in enumerate(elements) if e.get("type") == "text" and len(str(e.get("text", "")).split()) > 7]
    if long_text:
        out.append("NOTE (Ideogram 4): text to render longer than 7 words (region " + ", ".join(map(str, long_text))
                   + "); Ideogram suggests 5-7 words per text element")
    return out


PROMPT_FORMATS = ("auto", "MOSS JSON", "Ideogram JSON", "text")
FAMILY_OF_FORMAT = {"MOSS JSON": "moss", "Ideogram JSON": "ideogram", "text": "plain"}
FAMILY_LABEL = {"moss": "MOSS JSON", "ideogram": "Ideogram JSON", "plain": "text"}
# text encoders without a layout format of their own (class name prefixes): plain text
PLAIN_ENCODERS = ("Krea2", "Flux", "Flux2", "Flux3", "Anima", "SDXL", "SD1ClipModel", "SD2ClipModel")


MODEL_FAMILY = {"MOSS Image": "moss", "Ideogram 4": "ideogram"}      # a model picked on the node -> its format (else text)
MODEL_PICKS = ("MOSS Image", "Krea 2", "Ideogram 4", "Flux.1", "Flux.2", "Flux 3", "Anima", "SDXL", "SD1.5")


def prompt_family(model, clip, choice="auto", hint=None, edit=False, pick=None, layout=True, regions=True):
    """Which format the 'prompt' output (and 'positive') uses: "moss" (MOSS-Image layout JSON), "ideogram"
    (Ideogram 4 caption JSON) or "plain" (text). Returns (family, where it came from).

    pick: the model picked in the node's model dropdown (one of MODEL_PICKS), else None (auto). choice: the old
    hidden format value ("auto" or one of PROMPT_FORMATS; kept for API prompts). In auto: the connected model, else
    the connected clip's text encoder, else `hint` (the front end follows the 'prompt' output to the text encoder it
    feeds, and that encoder's loader), else MOSS.
    MOSS Image takes plain text instead of its layout JSON in Edit Mode (the edit LoRA takes an instruction), in its
    standard mode (layout=False, the node's layout / standard switch) and when no region is drawn or shown
    (regions=False: no boxes to lay out)."""
    family, where = _prompt_family(model, clip, choice, hint, pick)
    if family == "moss":
        if edit:
            return "plain", "MOSS Image edit: the edit LoRA takes an instruction"
        if not layout:
            return "plain", "MOSS Image standard mode (set on the node)"
        if not regions:
            return "plain", "MOSS Image without regions: standard mode"
    return family, where


def _prompt_family(model, clip, choice, hint, pick):
    if pick in MODEL_PICKS:
        return MODEL_FAMILY.get(pick, "plain"), pick + " (picked on the node)"
    if choice in FAMILY_OF_FORMAT:
        return FAMILY_OF_FORMAT[choice], "set on the node"
    from . import regional_lora as hl
    arch = hl.model_arch(model) if model is not None else None
    if arch is not None:
        return MODEL_FAMILY.get(arch.name, "plain"), arch.name + " model"
    te = getattr(clip, "cond_stage_model", None) if clip is not None else None
    if te is not None:
        names = [c.__name__ for c in type(te).__mro__]
        if any(n.startswith("MOSSImage") for n in names):
            return "moss", "MOSS Image text encoder"
        if any(n.startswith("Ideogram4") for n in names):
            return "ideogram", "Ideogram 4 text encoder"
        # SD1ClipModel is the base of most encoders: only the class itself (or SD2's) means SD1.5 / SD2
        if names[0].rstrip("_") in ("SD1ClipModel", "SD2ClipModel") or any(
                n.startswith(PLAIN_ENCODERS[:6]) for n in names):
            return "plain", "text encoder " + names[0].rstrip("_")
    if hint in FAMILY_OF_FORMAT.values():
        return hint, "the text encoder 'prompt' goes to"
    return "moss", "default"


# --------------------------------------------------------------------------- #
# Edit Mode (image-to-image): the 'image' input is the source to change
# --------------------------------------------------------------------------- #
MODES = ("generate", "edit")
EDIT_AREAS = ("only the regions", "whole image")
# models that can read the source as a reference image (an edit model, edit LoRA or edit node pack)
REF_MODELS = ("MOSS Image", "Krea 2", "Flux.1", "Flux.2", "Flux 3")
# MOSS-Image edit LoRA layouts, as in ComfyUI's Text Encode MOSS-Image Edit: the reference method and whether the
# text encoder also sees the references
MOSS_EDIT_FORMATS = {"Moss-Image-Edit": ("index_timestep_zero_text_start", False),
                     "ai-toolkit": ("index_timestep_zero_isolated", True),
                     "ai-toolkit (kv_cache off)": ("index_timestep_zero", True)}
VISION_PREFIX = "Picture {}: <|vision_start|><|image_pad|><|vision_end|>"


EDIT_MASK_DEFAULTS = {"grow": 8, "feather": 16}       # as Settings > Region Genie > Edit Mode


def grow_mask(m, px):
    """Boolean (H, W) mask grown by px pixels (round), or shrunk when px < 0. The image border counts as inside
    (a mask touching the border stays at the border when shrunk)."""
    px = int(px)
    if px == 0 or not m.any() or (px > 0 and m.all()):
        return m
    try:
        from scipy.ndimage import distance_transform_edt
        if px > 0:
            return distance_transform_edt(~m) <= px
        if m.all():
            return m
        return distance_transform_edt(m) > -px
    except Exception:                                   # no scipy: square growing with a box filter
        from .bbox_masks import box_blur
        b = box_blur(m.astype(np.float32)[None], abs(px), solid_border=True)[0]
        return b > 1e-6 if px > 0 else b >= 1.0 - 1e-6


def edit_mask(change, keep, whole, grow=0, feather=0):
    """The area the sampler may change in Edit Mode, as (H, W) float32 0..1, or None when everything may change.

    change / keep: boolean (H, W) masks of the regions set to change / to keep. whole: everything but the kept regions
    may change (else only the change regions). grow: px the area grows past the change regions (negative shrinks);
    kept regions are never grown into. feather: px of soft edge after growing; toward a kept region the soft edge
    lies outside it, so kept pixels stay exactly as they are."""
    if whole:
        if not keep.any():
            return None
        area = ~keep
    else:
        area = change.copy()
    if grow:
        area = grow_mask(area, grow)
    area &= ~keep
    feather = max(0, int(feather))
    if feather > 0 and keep.any():
        area &= ~grow_mask(keep, feather)
    m = area.astype(np.float32)
    if feather > 0:
        from .bbox_masks import box_blur
        m = box_blur(m[None], feather, solid_border=True)[0]
    m[keep] = 0.0
    return m


def edit_size(iw, ih, width, height, mult=16):
    """Canvas size for an edit: the source's aspect ratio at the pixel count of width x height, in steps of mult."""
    s = math.sqrt(float(width) * float(height) / max(1.0, float(iw) * float(ih)))
    return max(mult, int(round(iw * s / mult)) * mult), max(mult, int(round(ih * s / mult)) * mult)


def fit_image(image, width, height):
    """(B, H, W, C) image scaled to cover width x height and cropped at the centre."""
    import comfy.utils
    if int(image.shape[1]) == height and int(image.shape[2]) == width:
        return image
    return comfy.utils.common_upscale(image.movedim(-1, 1), width, height, "bicubic", "center").movedim(1, -1)


def limit_image(image, long_edge=0, max_area=0):
    """The image scaled down (never up) to a longest side of long_edge and / or at most max_area pixels."""
    import comfy.utils
    h, w = int(image.shape[1]), int(image.shape[2])
    s = 1.0
    if long_edge and max(w, h) > long_edge:
        s = min(s, long_edge / float(max(w, h)))
    if max_area and w * h > max_area:
        s = min(s, math.sqrt(max_area / float(w * h)))
    if s >= 1.0:
        return image
    return comfy.utils.common_upscale(image.movedim(-1, 1), max(1, round(w * s)), max(1, round(h * s)), "area",
                                      "disabled").movedim(1, -1)


def empty_latent(width, height, model=None, vae=None):
    """An empty latent of the canvas size, in the connected model's (else the VAE's, else SD's) latent format."""
    ch, ratio, dims = 4, 8, 2
    lf = getattr(getattr(model, "model", None), "latent_format", None) if model is not None else None
    if lf is not None:
        ch = int(getattr(lf, "latent_channels", 4))
        ratio = int(getattr(lf, "spacial_downscale_ratio", 8))
        dims = int(getattr(lf, "latent_dimensions", 2))
    elif vae is not None:
        ch = int(getattr(vae, "latent_channels", 4))
        try:
            ratio = int(vae.spacial_compression_encode())
        except Exception:
            ratio = 8
        dims = 3 if int(getattr(vae, "latent_dim", 2)) == 3 else 2
    shape = (1, ch, max(1, height // ratio), max(1, width // ratio))
    if dims >= 3:
        shape = (1, ch, 1) + shape[2:]
    return {"samples": torch.zeros(shape), "downscale_ratio_spacial": ratio}


def lora_edit_format(lora_name):
    """The MOSS-Image edit LoRA layout of a LoRA file, read from its safetensors header: ai-toolkit files fuse
    q/k/v, Moss-Image-Edit (chinoll) files keep them apart. None when the file can't be read."""
    try:
        import folder_paths
        path = folder_paths.get_full_path("loras", lora_name)
        if not path:
            return None
        with open(path, "rb") as f:
            n = int.from_bytes(f.read(8), "little")
            if n <= 0 or n > 200_000_000:
                return None
            head = json.loads(f.read(n))
    except Exception:
        return None
    keys = [k for k in head if k != "__metadata__"] if isinstance(head, dict) else []
    if not keys:
        return None
    return "ai-toolkit" if any("qkv" in k for k in keys) else "Moss-Image-Edit"


def auto_apart_on(data, family):
    """Whether 'keep all regions apart' turns on by itself for `family` (regional_lora.AUTO_APART_FAMILIES): the
    per-model setting sent by the front end ("on" / "off" / "default"), else the setting for all of them, else on.
    Workflows queued by older front ends send krea2AutoApart (Krea 2 only)."""
    m = data.get("autoApart") if isinstance(data.get("autoApart"), dict) else None
    if m is not None:
        v = m.get(family, "default")
        if v in (True, "on"):
            return True
        if v in (False, "off"):
            return False
        return m.get("all", True) is not False
    if family == "Krea 2":
        return data.get("krea2AutoApart", True) is not False
    return True


def import_sig(text):
    """Short fingerprint of an import_json string (the editor remembers which import it already used)."""
    import hashlib
    return hashlib.sha1(str(text).strip().encode("utf-8")).hexdigest()[:16]


def _region_type(t):
    t = str(t or "").lower()
    return "text" if t == "text" else ("character" if t == "character" else "object")


def layout_from_json(text, width, height):
    """import_json -> (paint_data v2 dict, scene prompt or None, negative scene prompt or None,
    background prompt or None).

    Reads a layout saved by this node (Export), and bbox layouts from other nodes: MOSS-Image layout JSON,
    Ideogram caption JSON / elements, Create Bounding Boxes bboxes. Boxes become rectangle layers; the first
    box is the top region. Raises ValueError when nothing usable is found."""
    from .bbox_masks import _parse_all, _to_pixels
    data = text
    for _ in range(2):                                   # tolerate JSON-in-a-JSON-string
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except (ValueError, TypeError):
                raise ValueError("import_json is not valid JSON")
    if isinstance(data, dict) and isinstance(data.get("layers"), list) and isinstance(data.get("regions"), list):
        regions = [r for r in data["regions"] if isinstance(r, dict) and "id" in r]
        # older files: centres as fractions of the size the file was made for -> offsets from the centre
        fw = _f(data.get("width"), 0) if _f(data.get("width"), 0) > 0 else width
        fh = _f(data.get("height"), 0) if _f(data.get("height"), 0) > 0 else height
        layers = []
        for l in data["layers"]:
            if isinstance(l, dict):
                ox, oy = layer_centre(l, fw, fh)
                l = {k: v for k, v in l.items() if k not in ("cx", "cy")}
                l["ox"], l["oy"] = ox, oy
                layers.append(l)
        scene = data.get("scene_prompt_positive", data.get("scene_prompt"))
        neg = data.get("scene_prompt_negative")
        bg = data.get("scene_prompt_background")
        st = {"v": 2, "regions": regions, "layers": layers}
        for k in ("sceneLoras", "loraOpts", "feather", "editMask"):
            if data.get(k):
                st[k] = data[k]
        opt = lambda v: str(v) if v is not None else None
        return st, opt(scene), opt(neg), opt(bg)

    scene = bg = None
    if isinstance(data, dict):
        summ = data.get("summary")
        if isinstance(summ, dict) and summ.get("caption") is not None:
            scene = str(summ.get("caption") or "")
        elif "high_level_description" in data or "compositional_deconstruction" in data:
            cd = data.get("compositional_deconstruction") if isinstance(data.get("compositional_deconstruction"), dict) else {}
            scene = str(data.get("high_level_description") or "").strip()
            bg = str(cd.get("background") or "").strip()
    entries, stats = _parse_all(data)
    if not entries:
        raise ValueError("import_json has no layout: expected a layout exported from the Region Genie node, "
                         "MOSS-Image layout JSON, Ideogram caption JSON / elements, or bboxes")
    boxes = _to_pixels(entries, width, height)
    short = float(min(width, height))
    regions, layers = [], []
    for i, (e, (x, y, w, h)) in enumerate(zip(entries, boxes)):
        rid = i + 1
        rtype = _region_type(e.get("type"))
        color = PALETTE[i] if i < len(PALETTE) else _extra_color(i)
        region = {"id": rid, "color": color, "prompt": str(e.get("prompt") or ""),
                  "type": rtype, "text": str(e.get("text") or "") if rtype == "text" else ""}
        pal = norm_palette(e.get("palette"))
        if pal:
            region["palette"], region["paletteOn"] = pal, True
        regions.append(region)
        layers.append({"id": rid, "name": f"Rectangle {rid}", "region": rid, "visible": True,
                       "shape": "rect", "sides": 5, "bw": max(1.0, w) / short, "bh": max(1.0, h) / short,
                       "sx": 1, "sy": 1, "rot": 0, "ox": (x + w / 2.0 - width / 2.0) / short,
                       "oy": (y + h / 2.0 - height / 2.0) / short,
                       "ops": []})
    layers.reverse()                                     # stack is bottom -> top; the first box goes on top
    return {"v": 2, "regions": regions, "layers": layers}, scene, None, bg


def register_routes():
    """POST /region_genie/convert_layout {json, width, height} -> {state, scene_prompt, scene_prompt_negative,
    scene_prompt_background} (file import button)."""
    try:
        from aiohttp import web
        from server import PromptServer
    except Exception:
        return

    @PromptServer.instance.routes.post("/region_genie/convert_layout")
    async def _convert_layout(request):
        try:
            body = await request.json()
            state, scene, neg, bg = layout_from_json(body.get("json", ""), int(body.get("width") or 1024),
                                                     int(body.get("height") or 1024))
            return web.json_response({"state": state, "scene_prompt": scene, "scene_prompt_negative": neg,
                                      "scene_prompt_background": bg})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=400)


register_routes()


# --------------------------------------------------------------------------- #
# node
# --------------------------------------------------------------------------- #
class RegionGenie:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {"default": 1024, "min": 16, "max": 16384, "step": 1,
                                  "tooltip": "Output size. The canvas follows it, also when connected to another node."}),
                "height": ("INT", {"default": 1024, "min": 16, "max": 16384, "step": 1}),
                "scene_prompt_positive": ("STRING", {"default": "", "multiline": True, "pysssss.autocomplete": False,
                                                     "tooltip": ("The whole-scene description.\n"
                                                                 "MOSS JSON: The summary caption.\n"
                                                                 "Ideogram JSON: The high_level_description.\n"
                                                                 "Text prompt: The first sentence.")}),
                "scene_prompt_negative": ("STRING", {"default": "", "multiline": True, "pysssss.autocomplete": False,
                                                     "tooltip": ("The negative prompt, encoded with the connected clip as the 'negative' output (like CLIP Text "
                                                                 "Encode).")}),
                "image_mode": (IMAGE_MODES, {"default": IMAGE_MODES[0],
                                             "tooltip": ("What a connected image does.\n"
                                                         "backdrop (trace over): Shown under the canvas to trace over.\n"
                                                         "use as color map: Used as the color map itself (its colors become regions; painting goes on "
                                                         "top).")}),
                "min_region_pixels": ("INT", {"default": 64, "min": 1, "max": 1000000,
                                              "tooltip": ("'use as color map' only. A color becomes a region when it has at least this many flat pixels "
                                                          "(pixels matching all 4 neighbours, at the image's own size). Blended edges and specks go to the "
                                                          "nearest region. Set in Settings > Region Genie (the editor sends it with each run); this hidden "
                                                          "value is only a fallback.")}),
                "paint_data": ("STRING", {"default": "", "multiline": False}),
            },
            "optional": {
                "model": ("MODEL", {"tooltip": ("MOSS Image, Krea 2, Ideogram 4, Flux, Anima or SDXL / SD1.5 model for the LoRAs set on the "
                                                "regions (any model for 'Whole image'). The 'model' output is this model with each LoRA acting "
                                                "only inside its region; connect it to the sampler. While the node's model dropdown is on auto, "
                                                "it also picks the prompt format.")}),
                "clip": ("CLIP", {"tooltip": ("Optional. The model's text encoder. It encodes 'positive' and 'negative', and lets each regional "
                                              "LoRA also act on its own region's caption (trigger words).")}),
                "vae": ("VAE", {"tooltip": ("Edit mode: Encodes the source image (the 'image' input) for the 'latent' output, and as a "
                                            "reference image for models that read one.\n"
                                            "It also sets the 'latent' format when no model is connected.")}),
                "image": ("IMAGE", {"tooltip": ("Optional.\n"
                                                "Generate mode: A backdrop to trace over, or the color map itself (see image_mode).\n"
                                                "Edit mode: The picture to change.")}),
                "size_from_image": ("IMAGE", {"tooltip": "Take width/height from this image. Takes priority over "
                                                         "size_from_latent and the width/height widgets."}),
                "size_from_latent": ("LATENT", {"tooltip": "Take width/height from this latent (auto-detects 16x for "
                                                           "MOSS Image / Flux 2 latents, 8x for SD/SDXL/Flux 1)."}),
                "import_mode": (IMPORT_MODES, {"default": IMPORT_MODES[0],
                                               "tooltip": ("What a new import_json does when the canvas already has layers.\n"
                                                           "ask before replacing: The node asks first (this run keeps the canvas).\n"
                                                           "always replace: The new layout replaces the canvas right away.\n"
                                                           "An empty canvas is always filled. Set in Settings > Region Genie (the editor sends it with each "
                                                           "run); this hidden value is only a fallback.")}),
                "scene_prompt_background": ("STRING", {"default": "", "multiline": True, "pysssss.autocomplete": False,
                                                       "tooltip": ("Ideogram 4 only. The background / setting behind the regions (ground, floor, sky, room ...), the "
                                                                   "'background' its caption JSON requires. Shown only while the model is Ideogram 4; other models "
                                                                   "don't use it.")}),
                "prompt_format": (PROMPT_FORMATS, {"default": "auto",
                                                   "tooltip": ("Hidden (kept for API prompts and old workflows). The node's model dropdown sets the format of "
                                                               "'prompt' and 'positive'.\n"
                                                               "auto: Follows the connected model, else the clip, else the text encoder 'prompt' is connected "
                                                               "to.")}),
                "mode": (MODES, {"default": MODES[0],
                                 "tooltip": ("generate: A new image.\n"
                                             "edit: The image on the 'image' input is the source to change (image-to-image). 'latent' is that "
                                             "image (connect vae), models that read a reference image get it on 'positive' / 'negative', and "
                                             "the edit LoRA set for the model in Settings is added to Whole image.")}),
                "edit_area": (EDIT_AREAS, {"default": EDIT_AREAS[0],
                                           "tooltip": ("Edit mode: What may change.\n"
                                                       "only the regions: 'latent' carries a mask of the regions set to change (like inpainting); the "
                                                       "rest stays as it is.\n"
                                                       "whole image: Everything except the regions set to keep (no mask when none is kept); the "
                                                       "sampler's denoise decides how much.\n"
                                                       "The mask's grow / feather are set in the region list header.")}),
                "import_json": ("STRING", {"forceInput": True,
                                           "tooltip": ("A layout to load into the editor when the workflow runs. It can be a file saved with Export "
                                                       "(e.g. through a Load Text node), MOSS-Image layout JSON, Ideogram caption JSON / elements, or "
                                                       "bboxes. Each new import_json is used once; edits made afterwards are kept.")}),
                # before width / height, which stay the last inputs (as asked)
                "control_image": ("IMAGE", {"tooltip": "Optional control map for the 'Control' row (a depth, canny, pose, "
                                                       "lineart ... map from any preprocessor). Without it, the node makes "
                                                       "a depth or canny map from 'image'."}),
                # shown as "width" / "height" (the size row at the top sets the hidden width / height widgets)
                "width_in": ("INT", {"forceInput": True, "min": 16, "max": 16384,
                                     "tooltip": ("Optional. The image width from another node. It overrides the size row at the top "
                                                 "(size_from_image and size_from_latent still come first).")}),
                "height_in": ("INT", {"forceInput": True, "min": 16, "max": 16384,
                                      "tooltip": ("Optional. The image height from another node. It overrides the size row at the top "
                                                  "(size_from_image and size_from_latent still come first).")}),
                # hidden; set with the seed control in the editor's footer (shown when Impact Pack is installed)
                "wildcard_seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF,
                                          "tooltip": "Seed for the wildcards in the prompt fields (ComfyUI Impact Pack's "
                                                     "__name__ and {a|b} syntax)."}),
            },
        }

    RETURN_TYPES = ("MODEL", "CONDITIONING", "CONDITIONING", "LATENT", "STRING", "IMAGE", "MASK", "BOUNDING_BOX", "ARRAY",
                    "STRING", "STRING", "INT", "INT")
    RETURN_NAMES = ("model", "positive", "negative", "latent", "prompt", "color_map", "masks", "bboxes", "elements",
                    "character_boxes", "region_info", "width", "height")
    OUTPUT_TOOLTIPS = (
        ("The connected model with the regions' LoRAs, each acting only inside its region (one pass; MOSS "
         "Image, Krea 2, Ideogram 4, Flux, Anima or SDXL / SD1.5). Connect it to the sampler, with "
         "'positive' as the prompt. Passed through unchanged when no LoRA is set and the regions aren't "
         "kept apart."),
        "'prompt' encoded with the connected clip. Empty when no clip is connected.",
        ("scene_prompt_negative encoded with the connected clip (like CLIP Text Encode), the negative "
         "prompt for the sampler. Empty when no clip is connected."),
        ("The latent for the sampler.\n"
         "generate: An empty latent of the canvas size (the connected model's format).\n"
         "edit: The source image (the 'image' input, encoded with vae) at the canvas size, with a mask of "
         "what may change (the regions set to change, or everything but the kept regions; grown and "
         "feathered as set in the region list header). Set the sampler's denoise below 1 to keep more of "
         "the source."),
        ("The prompt as text, in the format the model takes.\n"
         "MOSS Image: MOSS-Image layout JSON (plain text in its standard mode, with no regions, and in "
         "Edit Mode).\n"
         "Ideogram 4: Ideogram 4 caption JSON.\n"
         "Krea 2, Flux, Anima, SDXL / SD1.5 and other models: Plain text.\n"
         "The node's model dropdown picks the format; on auto, the connected model does, else the clip, "
         "else the text encoder this output is connected to. It also works as import_json for MOSS-Image "
         "Prompt Builder KJ or (Deno) Ideogram Director. Plain text alone doesn't say where the regions "
         "are; with the model on 'model' and clip connected, 'keep all regions apart' ties each region's "
         "sentence to its region (on automatically, see Settings > Region Genie)."),
        "Flat color region map (black = unspecified), e.g. for MOSS-Image Color/Depth Control. A region with a color "
        "palette is shown in its first palette color.",
        "One mask per region, in region order, as a batch (feathered as set on each region).",
        "Tight pixel bbox per region: MOSS-Image Prompt Builder KJ, Create Bounding Boxes, BBoxes to Masks.",
        "Elements with each region's prompt and type: MOSS-Image Layout Prompt (element), Create Bounding Boxes, "
        "BBoxes to Masks.",
        "Numbers of the character regions (e.g. \"1, 3\"): MOSS-Image Layout Prompt character_boxes.",
        "Text list of the regions with their index, color, prompt and bbox.",
        "Output width.",
        "Output height.",
    )
    FUNCTION = "run"
    CATEGORY = "Region Genie"

    @classmethod
    def VALIDATE_INPUTS(cls, import_mode=None):
        # accept a missing/empty import_mode (some frontends leave the optional combo blank) -> default
        return True

    def run(self, width, height, scene_prompt_positive, scene_prompt_negative, image_mode, min_region_pixels, paint_data,
            image=None,
            size_from_image=None, size_from_latent=None, import_json=None, import_mode=IMPORT_MODES[0],
            model=None, clip=None, scene_prompt_background="", prompt_format="auto", vae=None, mode=MODES[0],
            edit_area=EDIT_AREAS[0], width_in=None, height_in=None, wildcard_seed=0, control_image=None):
        from .bbox_masks import _resolve_size        # shared with BBoxes to Masks
        # the width / height sockets override the size row (whose result is in the hidden width / height widgets)
        if width_in is not None:
            width = max(16, min(16384, int(width_in)))
        if height_in is not None:
            height = max(16, min(16384, int(height_in)))
        edit = mode == "edit"
        edit_notes = []
        if edit and image is not None and size_from_image is None and size_from_latent is None:
            # the canvas takes the source's shape, at the pixel count of width x height
            width, height = edit_size(int(image.shape[2]), int(image.shape[1]), int(width), int(height))
            edit_notes.append(f"edit: canvas {width}x{height} (the source's shape at width x height pixels)")
        width, height, _src = _resolve_size(int(width), int(height), "auto", size_from_image, size_from_latent)
        regions, ops, layers = parse_paint_data(paint_data)
        # min region pixels and import mode are Settings now (Settings > Region Genie); the editor sends them in
        # paint_data. The hidden widgets are the fallback for prompts made without the editor (API, old frontends).
        try:
            _pd = json.loads(paint_data) if paint_data else {}
        except (ValueError, TypeError):
            _pd = {}
        if isinstance(_pd, dict):
            try:
                if _pd.get("minPixels") is not None:
                    min_region_pixels = max(1, min(1000000, int(_pd["minPixels"])))
            except (TypeError, ValueError):
                pass
            if _pd.get("importMode") in IMPORT_MODES:
                import_mode = _pd["importMode"]
        notes = []
        ui_import = None
        if import_mode not in IMPORT_MODES:
            import_mode = IMPORT_MODES[0]
        if isinstance(import_json, str) and import_json.strip():
            sig = import_sig(import_json)
            try:
                current = json.loads(paint_data) if paint_data else {}
            except (ValueError, TypeError):
                current = {}
            if not isinstance(current, dict) or current.get("importSig") != sig:
                state, imp_scene, imp_neg, imp_bg = layout_from_json(import_json, width, height)  # ValueError -> node error
                state["importSig"] = sig
                canvas_empty = not layers and not ops
                apply = import_mode == IMPORT_MODES[1] or canvas_empty
                ui_import = {"action": "applied" if apply else "pending", "sig": sig, "state": state,
                             "scene_prompt": imp_scene, "scene_prompt_negative": imp_neg,
                             "scene_prompt_background": imp_bg}
                if apply:
                    paint_data = json.dumps(state)
                    regions, ops, layers = parse_paint_data(paint_data)
                    if imp_scene is not None:
                        scene_prompt_positive = imp_scene
                    if imp_neg is not None:
                        scene_prompt_negative = imp_neg
                    if imp_bg is not None:
                        scene_prompt_background = imp_bg
                    notes.append("loaded the layout from import_json")
                else:
                    notes.append("NOTE: import_json has a new layout, but the canvas is not empty: choose "
                                 "Replace or Keep on the node (this run used the canvas)")

        # hidden regions (the region's eye in the list) are left out of everything; their layers are skipped like a
        # deleted region's, and image colors that belong to them become unspecified
        hidden_colors = {}
        for r in regions:
            if isinstance(r, dict) and r.get("hidden") is True:
                rgb = _hex_to_rgb(r.get("color", ""))
                if rgb is not None:
                    hidden_colors[_rgb_to_hex(rgb)] = 0
        regions = [r for r in regions if not (isinstance(r, dict) and r.get("hidden") is True)]

        # wildcards (Impact Pack): every text field is filled before anything is built from it (and before the LLM
        # Prompt Enhancer, so it sees the filled text). The editor shows what each field became.
        from .wildcards import Filler
        try:
            wc_cfg = json.loads(paint_data) if isinstance(paint_data, str) and paint_data.strip() else {}
        except (ValueError, TypeError):
            wc_cfg = {}
        fill = Filler(wildcard_seed, per_field=isinstance(wc_cfg, dict) and wc_cfg.get("wcPerField") is True, notes=notes)
        scene_prompt_positive = fill("scene", scene_prompt_positive)
        scene_prompt_negative = fill("negative", scene_prompt_negative)
        scene_prompt_background = fill("background", scene_prompt_background)
        regions = [dict(r) for r in regions]                # the filled text is for this run only
        for r in regions:
            if isinstance(r.get("prompt"), str):
                r["prompt"] = fill(f"r{r['id']}", r["prompt"])
            if isinstance(r.get("text"), str) and r["text"]:
                r["text"] = fill(f"r{r['id']}.text", r["text"])

        # region table: UI regions first (in list order), then colors found only in the image
        table = []                     # dicts: color(hex), prompt, source
        id_to_index = {}
        color_to_index = {}
        eff_colors = effective_colors([r for r in regions if isinstance(r, dict)])
        for r in regions:
            rgb = _hex_to_rgb(r.get("color", ""))
            if rgb is None or len(table) >= MAX_REGIONS:
                continue
            hexc = _rgb_to_hex(rgb)
            if hexc in color_to_index:            # duplicate color: same region
                id_to_index[r["id"]] = color_to_index[hexc]
                continue
            rtype = r.get("type") if r.get("type") in ("object", "character", "text") else "object"
            table.append({"rid": r["id"], "color": hexc, "prompt": str(r.get("prompt", "") or "").strip(), "source": "canvas",
                          "type": rtype, "text": str(r.get("text", "") or ""), "loras": r.get("loras") or [],
                          "palette": active_palette(r), "shown": eff_colors.get(r.get("id"), hexc),
                          "feather": r.get("feather"), "featherLinked": r.get("featherLinked", True),
                          "featherEdges": bool(r.get("featherEdges", False)), "keep": bool(r.get("keep"))})
            id_to_index[r["id"]] = len(table)
            color_to_index[hexc] = len(table)

        # LLM Prompt Enhancer: switched-on prompts are rewritten before anything is built from them
        llm_ui = None
        try:
            pdata = json.loads(paint_data) if isinstance(paint_data, str) and paint_data.strip() else {}
        except (ValueError, TypeError):
            pdata = {}
        if isinstance(pdata, dict) and (pdata.get("sceneLlm") or any(r.get("llm") for r in regions)):
            from . import llm_enhance
            scene_prompt_positive, llm_ui = llm_enhance.apply(pdata, regions, table, scene_prompt_positive, clip, notes)
            # the editor matches a result to the text typed in the field: give it the text before the wildcards
            for key, res in [("scene", (llm_ui or {}).get("scene"))] + [(f"r{k}", v) for k, v in ((llm_ui or {}).get("regions") or {}).items()]:
                f = fill.filled.get(key)
                if isinstance(res, dict) and f and str(res.get("prompt", "")).strip() == str(f["filled"]).strip():
                    res["prompt"] = f["raw"]

        index_img = Image.new("L", (width, height), 0)
        detected = []
        ui = {"dims": [width, height]}
        if fill.mod is not None:
            ui["wildcards"] = [json.dumps(fill.filled, ensure_ascii=False)]
        if llm_ui is not None:
            ui["llm"] = [json.dumps(llm_ui, ensure_ascii=False)]

        if image is not None:
            frame = image[0, :, :, :3]
            arr = (frame.clamp(0, 1) * 255).round().to(torch.uint8).cpu().numpy()
            if image_mode == IMAGE_MODES[1] and not edit:
                img_idx, img_colors = quantize_image(arr, min_region_pixels)
                remap = np.zeros(len(img_colors) + 1, np.uint8)
                for k, hexc in enumerate(img_colors, start=1):
                    if hexc not in color_to_index and hidden_colors and _match_color(hexc, hidden_colors) is not None:
                        continue                                  # a hidden region's color: stays unspecified (0)
                    match = _match_color(hexc, color_to_index)
                    if match is None:
                        if len(table) >= MAX_REGIONS:
                            continue
                        table.append({"color": hexc, "prompt": "", "source": "image", "type": "object", "text": "",
                                      "palette": [], "shown": hexc})
                        match = color_to_index[hexc] = len(table)
                    else:
                        hexc = table[match - 1]["color"]          # report the region's own color
                    remap[k] = match
                    detected.append(hexc)
                index_img = Image.fromarray(remap[img_idx], "L")
                if index_img.size != (width, height):
                    index_img = index_img.resize((width, height), Image.NEAREST)
            ui["backdrop"] = self._save_preview(image)
        ui["detected"] = [json.dumps(detected)]

        if layers is not None:
            idx = render_layers(np.asarray(index_img), layers, id_to_index)
        else:                                          # paint_data v1 (before layers)
            render_ops(index_img, ops, id_to_index, width, height)
            idx = np.asarray(index_img)

        # colors and outputs
        palette = np.zeros((len(table) + 1, 3), np.uint8)
        for k, row in enumerate(table, start=1):
            palette[k] = _hex_to_rgb(row["shown"])          # first palette color, or the region's own color
        color_map = torch.from_numpy(palette[idx].astype(np.float32) / 255.0)[None]

        from .bbox_masks import box_blur
        feather_all = _paint_feather(paint_data)
        masks, bboxes, elements, items, lines, characters = [], [], [], [], [], []
        for k, row in enumerate(table, start=1):
            m = idx == k
            if not m.any():
                if row["source"] == "canvas":
                    notes.append(f"NOTE: region {row['color']} ('{row['prompt'][:30]}') has no pixels, skipped")
                continue
            ys = np.nonzero(m.any(axis=1))[0]
            xs = np.nonzero(m.any(axis=0))[0]
            x0, x1, y0, y1 = int(xs[0]), int(xs[-1]) + 1, int(ys[0]), int(ys[-1]) + 1
            f = _region_feather(row, feather_all)
            mf = m.astype(np.float32)
            if f > 0:
                mf = box_blur(mf[None], f, solid_border=not row.get("featherEdges"))[0]
            masks.append(torch.from_numpy(np.ascontiguousarray(mf)))
            row["out_index"] = len(masks) - 1
            is_text = row["type"] == "text"
            etype = "text" if is_text else "obj"
            pal = list(row.get("palette") or [])
            bboxes.append({"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0,
                           "metadata": {"type": etype, "text": row["text"] if is_text else "",
                                        "desc": row["prompt"], "palette": pal}})
            # key orders as Create Bounding Boxes / Ideogram (type, bbox, [text], desc, color_palette) and
            # MOSS-Image Layout Prompt (label, caption, [text], [palette], bbox)
            el = {"type": etype,
                  "bbox": [_grid(y0, height), _grid(x0, width), _grid(y1, height), _grid(x1, width)]}
            if is_text:
                el["text"] = row["text"]
            el["desc"] = row["prompt"]
            if pal:
                el["color_palette"] = pal
            elements.append(el)
            item = {"label": row["type"], "caption": row["prompt"]}
            if is_text:
                item["text"] = row["text"]
            if pal:
                item["palette"] = pal
            item["bbox"] = _moss_bbox(el["bbox"], width, height)
            items.append(item)
            if row["type"] == "character":
                characters.append(len(masks))         # 1-based, as MOSS-Image Layout Prompt numbers boxes
            kind = "" if row["type"] == "object" else f" [{row['type']}" + (f": {row['text']!r}" if is_text else "") + "]"
            lines.append(f"index {len(masks) - 1}: {row['shown']}  x={x0} y={y0} {x1 - x0}x{y1 - y0}"
                         f"  \"{row['prompt']}\"{kind}" + (f"  palette {' '.join(pal)}" if pal else "")
                         + ("  (from image)" if row["source"] == "image" else "")
                         + ("  (LLM-enhanced)" if row.get("prompt_typed") is not None else ""))

        count = len(masks)
        mask_batch = torch.stack(masks, dim=0) if masks else torch.zeros((1, height, width), dtype=torch.float32)
        scene = str(scene_prompt_positive or "").strip()
        background = str(scene_prompt_background or "").strip()
        # Ideogram 4 caption JSON, as Ideogram's JSON prompting guide sets it out: high_level_description (required),
        # then compositional_deconstruction with background (required) and elements (type, bbox, [text], desc,
        # [color_palette]: up to 5 "#RRGGBB"). No style_description (optional): this node has no style fields.
        hld = scene or plain_prompt("", [it["caption"] for it in items])[0]
        ideogram = {"high_level_description": hld,
                    "compositional_deconstruction": {"background": background, "elements": elements}}
        moss = {"summary": {"caption": scene}, "items": items,
                "bbox_coord_space": "abs_centralized", "bbox_format": "yxyx"}

        moss_text = json.dumps(moss, ensure_ascii=False, separators=(",", ":"))
        ideogram_text = json.dumps(ideogram, ensure_ascii=False)
        # the background is Ideogram 4's alone (its caption JSON requires one): the text prompt leaves it out
        text_prompt, text_spans = plain_prompt(scene, [it["caption"] for it in items])
        # the prompt 'positive' encodes (and the regional LoRAs find their captions in): the model's format (picked
        # in the node's model dropdown, else the connected model ...)
        pd = pdata if isinstance(pdata, dict) else {}
        hint = pd.get("promptFormatHint")
        pick = pd.get("modelPick") if pd.get("modelPick") in MODEL_PICKS else None
        family, family_from = prompt_family(model, clip, prompt_format if prompt_format in PROMPT_FORMATS else "auto",
                                            hint, edit, pick=pick, layout=pd.get("mossLayout") is not False,
                                            regions=bool(items))
        if family == "ideogram":
            prompt_text, spans = ideogram_text, ideogram_desc_spans(ideogram_text, elements)
            notes += ideogram_notes(scene, background, elements)
        elif family == "plain":
            prompt_text, spans = text_prompt, text_spans
        else:
            prompt_text, spans = moss_text, caption_char_spans(moss_text, items)
        from . import regional_lora as hl
        arch = hl.model_arch(model) if model is not None else None
        ui["model_arch"] = [arch.name if arch is not None else ""]
        edit_cfg = pdata.get("edit") if isinstance(pdata, dict) and isinstance(pdata.get("edit"), dict) else {}
        src = refs = None
        moss_fmt = None
        if edit:
            if image is None:
                edit_notes.append("NOTE: edit mode: connect the image to change to the 'image' input")
            elif vae is None:
                edit_notes.append("NOTE: edit mode: connect vae, so the source image can be encoded for 'latent' "
                                  "(and as a reference image)")
            else:
                src = fit_image(image[:, :, :, :3], width, height)
            if arch is not None and arch.name in REF_MODELS and src is not None:
                ref_on = (edit_cfg.get("refs") or {}).get(arch.name, True) is not False
                if not ref_on:
                    edit_notes.append(f"edit: no reference image for {arch.name} (Settings > Region Genie > Edit Mode)")
                else:
                    long_edge = int(edit_cfg.get("refSize", 1024) or 0)
                    ref_img = limit_image(src, long_edge)
                    refs = [vae.encode(ref_img)]
                    if arch.name == "MOSS Image":
                        moss_fmt = self._moss_edit_format(pdata, edit_cfg, edit_notes)
                    edit_notes.append(f"edit: the source goes to the model as a reference image "
                                      f"({int(ref_img.shape[2])}x{int(ref_img.shape[1])}"
                                      + (f", {moss_fmt} layout" if moss_fmt else "") + ")")
            elif arch is not None and src is not None:
                edit_notes.append(f"edit: {arch.name} reads no reference image: image-to-image from 'latent' only "
                                  "(set the sampler's denoise below 1)")
        # MOSS ai-toolkit edit LoRAs: the text encoder sees the reference too, after a "Picture 1:" marker
        tok_kw, vision_prefix = {}, ""
        if moss_fmt and MOSS_EDIT_FORMATS[moss_fmt][1] and src is not None:
            vision_prefix = VISION_PREFIX.format(1)
            tok_kw = {"images": [limit_image(src, 0, 384 * 384)]}
        status = {}
        model_out, lora_lines = self._regional_loras(model, clip, paint_data, table, masks, vision_prefix + prompt_text,
                                                     [(a + len(vision_prefix), b + len(vision_prefix)) if c else None
                                                      for c in spans for a, b in [c or (0, 0)]],
                                                     notes, status, family=family, edit=edit, tok_kw=tok_kw,
                                                     base=len(vision_prefix))
        ui["auto_apart"] = [bool(status.get("auto_apart"))]
        positive = negative = None
        lines.append(f"prompt: {FAMILY_LABEL[family]} ({family_from})")
        ui["prompt_format"] = [FAMILY_LABEL[family]]
        if clip is not None:
            positive = clip.encode_from_tokens_scheduled(clip.tokenize(vision_prefix + prompt_text, **tok_kw))
            negative = clip.encode_from_tokens_scheduled(clip.tokenize(vision_prefix + str(scene_prompt_negative or ""),
                                                                       **tok_kw))
            if refs:
                import node_helpers
                if moss_fmt:
                    vals, app = {"reference_latents": refs, "reference_latents_method": MOSS_EDIT_FORMATS[moss_fmt][0]}, False
                else:
                    vals, app = {"reference_latents": refs}, True
                positive = node_helpers.conditioning_set_values(positive, vals, append=app)
                negative = node_helpers.conditioning_set_values(negative, vals, append=app)
        elif refs:
            edit_notes.append("NOTE: edit mode: connect clip, so the reference image can go on 'positive'")
        # the latent for the sampler
        if src is not None:
            latent = {"samples": vae.encode(src)}
            whole = edit_area == EDIT_AREAS[1]
            em = pdata.get("editMask") if isinstance(pdata, dict) and isinstance(pdata.get("editMask"), dict) else {}
            def _px(key, lo, hi):
                try:
                    return max(lo, min(hi, int(round(float(em.get(key, EDIT_MASK_DEFAULTS[key]))))))
                except (TypeError, ValueError):
                    return EDIT_MASK_DEFAULTS[key]
            grow, feather_px = _px("grow", -256, 256), _px("feather", 0, 256)
            placed = [(k, row) for k, row in enumerate(table, start=1) if row.get("out_index") is not None]
            kept = [row["out_index"] for _, row in placed if row.get("keep")]
            changed = [row["out_index"] for _, row in placed if not row.get("keep")]
            keep_hw = np.isin(idx, [k for k, row in placed if row.get("keep")])
            change_hw = np.isin(idx, [k for k, row in placed if not row.get("keep")])
            if not placed and not whole:
                edit_notes.append("NOTE: edit mode: no regions yet, so the whole image may change")
            else:
                em_hw = edit_mask(change_hw, keep_hw, whole, grow, feather_px)
                if em_hw is None:
                    edit_notes.append("edit: the whole image may change (the sampler's denoise decides how much)")
                else:
                    t = torch.from_numpy(np.ascontiguousarray(em_hw))
                    latent["noise_mask"] = t.reshape((1, 1, int(em_hw.shape[0]), int(em_hw.shape[1])))
                    what = ("everything but the kept regions changes" if whole else
                            "only the regions set to change change")
                    edit_notes.append(f"edit: {what} (the latent carries a mask; grow {grow} px, feather {feather_px} px)"
                                      + (f"; change: {', '.join(map(str, changed))}" if changed and not whole else "")
                                      + (f"; keep: {', '.join(map(str, kept))}" if kept else ""))
                    if not whole and not changed:
                        edit_notes.append("NOTE: edit mode: every region is set to keep, so nothing may change; set a "
                                          "region to change, or 'change' to whole image")
        else:
            latent = empty_latent(width, height, model, vae)
        # Control (the list's 'Control' row): ControlNet / control LoRA for the connected model
        from . import control as ctl
        ccfg = ctl.config(pdata)
        if ccfg is not None:
            try:
                rmask = ctl.region_mask(regions, id_to_index, idx)
                missing = []
                model_out, positive, negative, cmap = ctl.apply(ccfg, arch.name if arch is not None else None, model_out,
                                                                positive, negative, vae, image, control_image, color_map,
                                                                rmask, width, height, notes, missing)
                if missing:
                    ui["control_missing"] = [json.dumps(missing)]
                if cmap is not None:
                    ui["control_map"] = self._save_preview(cmap, "regiongenie.control")
            except Exception as e:            # a broken control file must not stop the run
                logging.exception(f"{LOG} control failed")
                notes.append(f"NOTE: control could not be applied: {e}")
        lines += edit_notes
        lines += lora_lines
        info = "\n".join([f"{count} region(s) on {width}x{height} canvas"] + lines + notes)
        logging.info(f"{LOG} {info}")
        ui["region_info"] = [info]
        if ui_import is not None:
            ui["layout_import"] = [json.dumps(ui_import, ensure_ascii=False)]
        return {
            "ui": ui,
            "result": (model_out, positive, negative, latent, prompt_text, color_map, mask_batch, [bboxes] if bboxes else [],
                       elements, ", ".join(str(c) for c in characters), info, width, height),
        }

    @staticmethod
    def _moss_edit_format(pdata, edit_cfg, notes):
        """The MOSS-Image edit LoRA layout: set in Settings, else read from the MOSS edit LoRA in Whole image."""
        fmt = edit_cfg.get("mossFormat", "auto")
        if fmt in MOSS_EDIT_FORMATS:
            return fmt
        rows = [x for x in (pdata.get("sceneLoras") or []) if isinstance(x, dict) and x.get("edit") == "MOSS Image"
                and x.get("on", True) and x.get("lora")]
        if not rows:
            notes.append("NOTE: MOSS Image edit needs an edit LoRA (set one in Settings > Region Genie > Edit Mode, or "
                         "add it to Whole image); used the Moss-Image-Edit layout")
            return "Moss-Image-Edit"
        found = lora_edit_format(str(rows[0]["lora"]))
        return found or "Moss-Image-Edit"

    @staticmethod
    def _regional_loras(model, clip, paint_data, table, masks, prompt_text, spans, notes, status=None, family=None,
                        edit=False, tok_kw=None, base=0):
        """The whole-image LoRAs merged into the model (like Load LoRA), and the regions' LoRAs as a model patch:
        one pass, each LoRA limited to its region's image tokens (+ its caption's text tokens when clip is
        connected), regions kept apart in attention for the first steps."""
        from . import regional_lora as hl
        try:
            data = json.loads(paint_data) if isinstance(paint_data, str) and paint_data.strip() else {}
        except (ValueError, TypeError):
            data = {}
        if not isinstance(data, dict):
            data = {}
        def active(lst):
            out = []
            for x in lst if isinstance(lst, list) else []:
                try:
                    if isinstance(x, dict) and x.get("on", True) and x.get("lora") and float(x.get("strength", 1)) != 0:
                        out.append((str(x["lora"]), float(x.get("strength", 1))))
                except (TypeError, ValueError):
                    pass
            return out
        arch = hl.model_arch(model) if model is not None else None
        from . import control as ctl
        ccfg = ctl.config(data)
        # edit LoRAs added by Edit Mode (Settings > Region Genie > Edit Mode): only the one for the connected model;
        # control LoRAs added by the Control row: only for the connected model while control is on
        scene_rows = []
        for x in data.get("sceneLoras") or []:
            if isinstance(x, dict) and x.get("control"):
                if ctl.lora_tag_ok(x, ccfg, arch.name if arch is not None else None):
                    scene_rows.append(x)
                continue
            tag = x.get("edit") if isinstance(x, dict) else None
            if tag:
                if not edit or arch is None or tag != arch.name:
                    if edit and x.get("on", True):
                        notes.append(f"edit LoRA for {tag} not used: the model is "
                                     f"{arch.name if arch is not None else 'not connected or unknown'}")
                    continue
            scene_rows.append(x)
        scene = active(scene_rows)
        regional = [(row, active(row.get("loras"))) for row in table if row.get("out_index") is not None]
        regional = [(row, ls) for row, ls in regional if ls]
        skipped = sum(1 for row in table if row.get("out_index") is None and active(row.get("loras")))
        if skipped:
            notes.append(f"NOTE: {skipped} region(s) with LoRAs have no pixels; their LoRAs are not used")
        opts = data.get("loraOpts") if isinstance(data.get("loraOpts"), dict) else {}
        all_apart = bool(opts.get("allRegions"))
        # models without a layout format (Krea 2, Flux, Anima, SDXL ...) get the regions as plain sentences: they are
        # placed by tying each region's sentence to its region in attention, so 'keep all regions apart' turns on by
        # itself when a region has a prompt (Settings > Region Genie: one setting for all those models, and one per
        # model; the front end sends them in paint_data)
        plain_layout = arch is not None and (arch.family in hl.AUTO_APART_FAMILIES or family == "plain")
        if (not all_apart and plain_layout
                and auto_apart_on(data, arch.family)
                and any(str(row.get("prompt") or "").strip() for row in table if row.get("out_index") is not None)):
            if clip is None:
                notes.append(f"NOTE: {arch.name}: connect clip so each region's prompt can be tied to its region "
                             "('keep all regions apart' needs it to place the regions)")
            else:
                all_apart = True
                if status is not None:
                    status["auto_apart"] = True
                notes.append(f"keep all regions apart: on automatically for {arch.name} (a region has a prompt; "
                             "Settings > Region Genie > keep all regions apart automatically)")
        if all_apart and model is not None and not hl.one_pass_ok(model):
            notes.append(f"NOTE: 'keep all regions apart' needs a {hl.ONE_PASS_MODELS} model; it was not used")
            all_apart = False
        if all_apart and model is None:
            notes.append("NOTE: 'keep all regions apart' is on, but no model is connected to the 'model' input")
            all_apart = False
        if not scene and not regional and not all_apart:
            return model, []
        if model is None:
            notes.append("NOTE: LoRAs are set on regions, but no model is connected to the 'model' input")
            return model, []
        if regional and not hl.one_pass_ok(model):
            raise ValueError(f"Region Genie: regional LoRAs on the 'model' output need a {hl.ONE_PASS_MODELS} model. "
                             "For other models use the Regional LoRAs node (separate passes). (Whole-image LoRAs work "
                             "with any model.)")
        def clamp(v, d):
            try:
                return min(1.0, max(0.0, float(v)))
            except (TypeError, ValueError):
                return d
        separation, until = clamp(opts.get("separation"), 0.85), clamp(opts.get("until"), 0.25)

        # spans: each region's caption in prompt_text, as character ranges (trigger words act with their LoRA)
        if all_apart:          # every region with pixels, LoRAs or not
            lora_of = {id(row): ls for row, ls in regional}
            chosen = [(row, lora_of.get(id(row), [])) for row in table if row.get("out_index") is not None]
        else:
            chosen = regional
        regions = [(row["out_index"], masks[row["out_index"]], spans[row["out_index"]], ls) for row, ls in chosen]
        return hl.regional_lora_patch(model, clip, prompt_text, regions, scene, separation, until, notes,
                                      separate_all=all_apart, tok_kw=tok_kw, base=base,
                                      share_background=bool(opts.get("shareBg")))

    @staticmethod
    def _save_preview(image, prefix="regiongenie.backdrop"):
        try:
            import nodes
            saved = nodes.PreviewImage().save_images(image[:1], prefix)
            return saved["ui"]["images"]
        except Exception as e:  # preview is a convenience only
            logging.warning(f"{LOG} could not save the backdrop preview: {e}")
            return []
