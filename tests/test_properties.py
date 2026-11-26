"""Property tests: rules that must hold for every input, tried with a few hundred generated inputs each (Hypothesis).

The other tests check the cases somebody thought of; these look for the ones nobody did (odd characters, sizes at
the edges, empty and huge values). A failure prints the smallest input that breaks the rule. Without the Hypothesis
package the file says so and passes (`pip install hypothesis`); GitHub Actions has it.

    python3 tests/test_properties.py        (RG_EXAMPLES=2000 for a longer search)
"""
import io
import json
import os
import re
import struct
import sys
import tempfile
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from stubs import check, fails  # noqa: E402

try:
    from hypothesis import HealthCheck, given, settings, strategies as st
except ImportError:
    print("SKIP property tests: the hypothesis package is not installed (pip install hypothesis)")
    sys.exit(0)

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from rgpack import bbox_masks as bm  # noqa: E402
from rgpack import gen_params as gp  # noqa: E402
from rgpack import model_paths as mp  # noqa: E402
from rgpack import region_genie as rg  # noqa: E402
from rgpack import save_image as si  # noqa: E402
from rgpack import tiled_diffusion as td  # noqa: E402
from rgpack import wildcards as wc  # noqa: E402

N = int(os.environ.get("RG_EXAMPLES", "300"))
SET = settings(max_examples=N, deadline=None, derandomize=True, database=None,
               suppress_health_check=list(HealthCheck))


def prop(name, *strategies, **kw):
    """Run fn over generated inputs; one PASS / FAIL line, with the smallest failing input."""
    def deco(fn):
        try:
            SET(given(*strategies, **kw)(fn))()
            check(name, True)
        except Exception as e:                                  # Hypothesis reports the shrunk example in the message
            note = getattr(e, "__notes__", None) or []
            print("     " + (str(e).splitlines() or [type(e).__name__])[0][:300])
            for n in note[:3]:
                print("     " + str(n)[:400])
            check(name, False)
        return fn
    return deco


text = st.text(max_size=40)
json_value = st.recursive(st.none() | st.booleans() | st.integers(-10**6, 10**6) | st.floats(allow_nan=False, allow_infinity=False, width=32) | text,
                          lambda c: st.lists(c, max_size=4) | st.dictionaries(st.sampled_from(
                              ["regions", "layers", "ops", "id", "items", "elements", "bbox", "bboxes", "box", "caption", "desc", "summary",
                               "type", "palette", "x", "y", "width", "height", "feather", "prompt", "text", "a", "b"]) | text, c, max_size=5),
                          max_leaves=25)


# --------------------------------------------------------------------------- tiles
@prop("tiles: start at 0, stay inside, end exactly at the edge, leave no gap",
      st.integers(1, 700), st.integers(1, 160).map(lambda v: v * 2), st.integers(0, 319))
def _(size, tile, overlap):
    overlap = min(overlap, tile - 2)                  # as TileGrid calls it: an even tile, an overlap of at most tile - 2
    s = td.tile_starts(size, tile, overlap)
    assert s == sorted(set(s)) and s[0] == 0
    if tile >= size:
        assert s == [0]
        return
    assert all(0 <= p <= size - tile for p in s)
    assert s[-1] + tile == size, "the last tile does not end at the edge"
    for a, b in zip(s, s[1:]):
        assert b <= a + tile, "a gap between two tiles"


@prop("tiles: every cell of the picture is inside a tile",
      st.integers(1, 400), st.integers(1, 100).map(lambda v: v * 2), st.integers(0, 199))
def _(size, tile, overlap):
    overlap = min(overlap, tile - 2)
    covered = np.zeros(size, bool)
    for p in td.tile_starts(size, tile, overlap):
        covered[p:p + tile] = True
    assert covered.all()


# --------------------------------------------------------------------------- masks and colors
def encode_runs(flat):
    runs, val, n = [], 0, 0
    for v in flat:
        if v == val:
            n += 1
        else:
            runs.append(n)
            val, n = v, 1
    runs.append(n)
    return runs


@prop("run-length masks: encode then decode gives the mask back", st.integers(1, 12), st.integers(1, 12), st.data())
def _(w, h, data):
    flat = data.draw(st.lists(st.integers(0, 1), min_size=w * h, max_size=w * h))
    out = rg.decode_runs(encode_runs(flat), w, h)
    assert out.shape == (h, w) and out.reshape(-1).tolist() == flat


@prop("run-length masks: any list of runs gives a mask of the right size and never raises",
      st.integers(1, 12), st.integers(1, 12), st.lists(st.integers(-5, 200) | st.none() | text, max_size=12))
def _(w, h, runs):
    out = rg.decode_runs(runs, w, h)
    assert out.shape == (h, w) and set(np.unique(out)) <= {0, 1}


@prop("colors: #RRGGBB to numbers and back", st.tuples(st.integers(0, 255), st.integers(0, 255), st.integers(0, 255)))
def _(c):
    assert rg._hex_to_rgb(rg._rgb_to_hex(c)) == c


@prop("palettes: at most 5 valid colors, and cleaning a clean palette changes nothing", st.lists(json_value | st.from_regex(r"#?[0-9a-fA-F]{6}", fullmatch=True), max_size=9))
def _(p):
    out = rg.norm_palette(p)
    assert len(out) <= 5 and all(re.fullmatch(r"#[0-9A-F]{6}", c) for c in out)
    assert rg.norm_palette(out) == out


hexcol = st.from_regex(r"#[0-9A-F]{6}", fullmatch=True)


@prop("palette regions: each gets a valid color that is not black and not another palette region's color",
      st.lists(st.fixed_dictionaries({"color": hexcol, "paletteOn": st.booleans(), "palette": st.lists(hexcol, max_size=6)}), max_size=8))
def _(regions):
    for i, r in enumerate(regions):
        r["id"] = i + 1
    out = rg.effective_colors(regions)
    assert set(out) == {r["id"] for r in regions if r["paletteOn"] and rg.norm_palette(r["palette"])}
    assert all(re.fullmatch(r"#[0-9A-F]{6}", c) and c != "#000000" for c in out.values())
    assert len(set(out.values())) == len(out)


# --------------------------------------------------------------------------- the prompt's numbers and text
@prop("MOSS boxes: a box in pixels becomes 0-1000 and back within two pixels, inside the canvas, never inside out",
      st.integers(16, 4096), st.integers(16, 4096), st.data())
def _(w, h, data):
    x0 = data.draw(st.integers(0, w - 1)); x1 = data.draw(st.integers(x0 + 1, w))
    y0 = data.draw(st.integers(0, h - 1)); y1 = data.draw(st.integers(y0 + 1, h))
    g = [rg._grid(y0, h), rg._grid(x0, w), rg._grid(y1, h), rg._grid(x1, w)]
    assert all(0 <= v <= 1000 for v in g) and g[0] <= g[2] and g[1] <= g[3]
    py0, px0, py1, px1 = rg._moss_bbox(g, w, h)
    tol_x, tol_y = w / 1000 + 2, h / 1000 + 2
    assert abs(px0 + w // 2 - x0) <= tol_x and abs(px1 + w // 2 - x1) <= tol_x
    assert abs(py0 + h // 2 - y0) <= tol_y and abs(py1 + h // 2 - y1) <= tol_y
    assert -(w // 2) <= px0 <= px1 <= w - w // 2 and -(h // 2) <= py0 <= py1 <= h - h // 2


def spans_ok(make_text, spans_fn, key, captions, summary):
    items = [{key: c, "bbox": [0, 0, 1, 1]} for c in captions]
    txt = make_text(summary, items)
    spans = spans_fn(txt, items)
    assert len(spans) == len(items)
    for c, s in zip(captions, spans):
        assert s is not None, "a caption was not found in the prompt"
        assert json.loads('"' + txt[s[0]:s[1]] + '"') == c, "the span is not this region's caption"
    for a, b in zip(spans, spans[1:]):
        assert a[1] <= b[0], "the spans are out of order"


@prop("regional LoRAs, MOSS-Image: each region's caption is found at its own place in the prompt, whatever the texts are",
      st.lists(text, max_size=5), text)
def _(captions, summary):
    spans_ok(lambda s, items: json.dumps({"summary": {"caption": s}, "items": items}, ensure_ascii=False, separators=(",", ":")),
             rg.caption_char_spans, "caption", captions, summary)


@prop("regional LoRAs, Ideogram 4: each element's description is found at its own place in the prompt, whatever the texts are",
      st.lists(text, max_size=5), text)
def _(captions, summary):
    spans_ok(lambda s, items: json.dumps({"high_level_description": s, "elements": items}, ensure_ascii=False),
             rg.ideogram_desc_spans, "desc", captions, summary)


@prop("Edit Mode size: a multiple of 16, at least 16, about the asked pixel count, about the source's shape",
      st.integers(64, 8192), st.integers(64, 8192), st.integers(256, 4096), st.integers(256, 4096))
def _(iw, ih, w, h):
    ow, oh = rg.edit_size(iw, ih, w, h)
    assert ow % 16 == 0 and oh % 16 == 0 and ow >= 16 and oh >= 16
    if 1 / 8 <= iw / ih <= 8:
        assert abs(ow * oh - w * h) / (w * h) < 0.25
        assert abs(ow / oh - iw / ih) / (iw / ih) < 0.25


# --------------------------------------------------------------------------- what comes in from outside
@prop("the node's saved data: any text is read without an error, as lists", text | json_value.map(lambda v: json.dumps(v)))
def _(t):
    regions, ops, layers = rg.parse_paint_data(t)
    assert isinstance(regions, list) and isinstance(ops, list) and (layers is None or isinstance(layers, list))
    assert all(isinstance(r, dict) and "id" in r for r in regions)


@prop("old model name: the change is made once (a second pass changes nothing) and prompts keep their words",
      st.dictionaries(st.sampled_from(["modelPick", "edit", "control", "prompt", "MOSS Image", "x"]), st.sampled_from(["MOSS Image", "MOSS-Image", "a MOSS Image picture", "Krea 2"]) | text, max_size=5))
def _(d):
    once = rg.migrate_names(json.dumps(d))
    assert rg.migrate_names(once) == once
    back = json.loads(once)
    if "prompt" in d:
        assert back.get("prompt") == d["prompt"]


@prop("import_json: any JSON gives a layout or the 'no layout' message, never another error", json_value, st.integers(64, 2048), st.integers(64, 2048))
def _(v, w, h):
    try:
        state, scene, neg, bg = rg.layout_from_json(json.dumps(v), w, h)
    except ValueError:
        return
    assert state["v"] == 2 and isinstance(state["regions"], list) and isinstance(state["layers"], list)
    json.dumps(state)


@prop("bbox reader: any JSON is read without an error", json_value)
def _(v):
    entries, stats = bm._parse_all(v)
    assert isinstance(entries, list)
    bm._to_pixels(entries, 1024, 768)


@prop("wildcard seed: the same input gives the same seed, inside the allowed range", st.integers(-2**70, 2**70) | st.none(), text, st.booleans())
def _(seed, key, per_field):
    a = wc.field_seed(seed, key, per_field)
    assert a == wc.field_seed(seed, key, per_field) and 0 <= a <= wc.SEED_MAX


@prop("wildcard syntax check: any text, no error; JSON is never taken for wildcards", text | json_value.map(json.dumps))
def _(t):
    r = wc.has_syntax(t)
    assert isinstance(r, bool)
    try:
        json.loads(t)
        is_json = t.strip()[:1] in "{["
    except ValueError:
        is_json = False
    assert not (is_json and r)


@prop("model names: a name without a folder prefix is not split; a split name joins back to itself", text)
def _(name):
    folder, rest = mp.split_folder(name)
    if folder is None:
        assert rest == name
    else:
        assert folder + ":" + rest == name


# --------------------------------------------------------------------------- Save Image
def png_with(kind, data):
    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, "PNG")
    raw = buf.getvalue()
    chunk = struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return raw[:33] + chunk + raw[33:]                        # right after IHDR


@prop("settings text in a PNG: any text is read back the same by Pillow", st.text(st.characters(blacklist_categories=("Cs",), blacklist_characters="\x00"), max_size=60))
def _(value):
    kind, data = gp.png_text_chunk("parameters", value)
    info = Image.open(io.BytesIO(png_with(kind, data))).info
    assert info.get("parameters") == value


@prop("settings text in a JPEG / WebP: any text is read back the same from the EXIF comment", st.text(st.characters(blacklist_categories=("Cs",)), max_size=60))
def _(value):
    raw = gp.user_comment(value)
    assert raw[:8] == b"UNICODE\x00" and raw[8:].decode("utf-16-be") == value


@prop("settings text values: a value with a comma, a colon or a line break is quoted, and unquotes to itself", text)
def _(v):
    q = gp._quote(v)
    if any(c in v for c in ",:\n"):
        assert json.loads(q) == v
    else:
        assert q == v


@prop("LoRA tags: one tag per LoRA name (case ignored), each well formed",
      st.lists(st.tuples(st.from_regex(r"[A-Za-z0-9_ .\\/-]{0,20}", fullmatch=True), st.floats(-4, 4, allow_nan=False)), max_size=8))
def _(loras):
    tags = gp.lora_tags(loras)
    names = [t[6:t.rindex(":")].lower() for t in tags]
    assert len(names) == len(set(names)) and all(re.fullmatch(r"<lora:[^<>]+:-?[0-9.]+>", t) for t in tags)
    assert set(names) == {gp._stem(n).lower() for n, _ in loras if gp._stem(n)}


@prop("PNG, 8 bit: the saved picture and its transparency are the pixels that went in",
      st.integers(1, 9), st.integers(1, 9), st.booleans(), st.integers(0, 9), st.integers(0, 2**32 - 1))
def _(w, h, with_alpha, level, seed):
    r = np.random.default_rng(seed)
    rgb = r.random((h, w, 3)).astype(np.float32)
    alpha = r.random((h, w)).astype(np.float32) if with_alpha else None
    im = np.asarray(Image.open(io.BytesIO(si.encode_png(rgb, alpha, level, 8, None))))
    assert np.array_equal(im[..., :3], si._u8(rgb))
    if with_alpha:
        assert np.array_equal(im[..., 3], si._u8(alpha))


@prop("file numbers: after any saved file the next number is higher, whatever characters the name has",
      st.from_regex(r"[A-Za-z0-9 _.()\[\]+^$-]{1,16}", fullmatch=True), st.lists(st.integers(1, 99998), min_size=1, max_size=4), st.sampled_from(["png", "webp", "jpg", "json"]))
def _(prefix, numbers, ext):
    with tempfile.TemporaryDirectory() as d:
        for n in numbers:
            open(os.path.join(d, f"{prefix}_{n:05d}.{ext}"), "w").close()
        open(os.path.join(d, f"other_{99999:05d}.png"), "w").close()
        assert si.next_counter(d, prefix) == max(numbers) + 1


print("\n%d failed" % len(fails) if fails else "\nALL PASS")
sys.exit(1 if fails else 0)
