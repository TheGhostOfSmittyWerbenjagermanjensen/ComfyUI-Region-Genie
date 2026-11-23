"""Draws the README's Quick start diagram: docs/images/quickstart-dark.svg and quickstart-light.svg.
(A drawn picture since round 70: Mermaid can't start an arrow at a box's bottom, and GitHub lays its pan / zoom
buttons over a Mermaid diagram.) Change the boxes or the arrows here, then run:  python3 tests/make_diagram.py
The README picks the file by the reader's light / dark setting (<picture>, prefers-color-scheme). That follows the
system's setting: with GitHub's theme set by hand to the opposite, the other file shows. So each file has its own
panel (a rounded rectangle in its own background color) and reads well on either page."""
import os

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "images")
# the row: (text, x, width); the arrow between Region Genie and KSampler carries a two-line label
BOXES = [("Load model, clip, vae", 20, 170), ("Region Genie ✨", 230, 150), ("KSampler", 590, 100), ("VAE Decode", 730, 120), ("Save Image ✨", 890, 140)]
LABEL = ("model, positive, negative,", "latent")
Y, H, W, TOTAL_H = 32, 44, 1050, 146


def svg(dark):
    fg, box, line, lab, panel, edge = (("#e6edf3", "#22262d", "#9aa4b1", "#30363d", "#12151a", "#3a404a") if dark
                                       else ("#1f2328", "#f6f8fa", "#59636e", "#eaeef2", "#ffffff", "#c9d1d9"))
    ym = Y + H / 2
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {TOTAL_H}" width="{W}" height="{TOTAL_H}" '
           'font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="14">',
           '<title>Load model, clip, vae → Region Genie → (model, positive, negative, latent) → KSampler → VAE Decode → Save Image; '
           'the vae also goes from the loader to VAE Decode</title>',
           f'<rect x="0.5" y="0.5" width="{W - 1}" height="{TOTAL_H - 1}" rx="10" fill="{panel}" stroke="{edge}"/>',
           f'<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">'
           f'<path d="M0 0L10 5L0 10z" fill="{line}"/></marker></defs>']
    for (_, x1, w1), (_, x2, _w2) in zip(BOXES, BOXES[1:]):
        out.append(f'<path d="M{x1 + w1} {ym}H{x2 - 2}" stroke="{line}" fill="none" marker-end="url(#a)"/>')
    for t, x, w in BOXES:
        out.append(f'<rect x="{x}" y="{Y}" width="{w}" height="{H}" rx="5" fill="{box}" stroke="{line}"/>'
                   f'<text x="{x + w / 2}" y="{ym + 5}" text-anchor="middle" fill="{fg}">{t}</text>')
    lx = (BOXES[1][1] + BOXES[1][2] + BOXES[2][1]) / 2 - 4
    out.append(f'<rect x="{lx - 93}" y="{ym - 21}" width="186" height="42" rx="3" fill="{lab}"/>'
               f'<text x="{lx}" y="{ym - 3}" text-anchor="middle" fill="{fg}" font-size="12.5">{LABEL[0]}</text>'
               f'<text x="{lx}" y="{ym + 14}" text-anchor="middle" fill="{fg}" font-size="12.5">{LABEL[1]}</text>')
    # vae: down from the loader's bottom middle, under the row, up into VAE Decode's bottom middle
    xa, xb, yb, yl = BOXES[0][1] + BOXES[0][2] / 2, BOXES[3][1] + BOXES[3][2] / 2, Y + H, 114
    out.append(f'<path d="M{xa} {yb}V{yl}H{xb}V{yb + 2}" stroke="{line}" fill="none" marker-end="url(#a)"/>')
    out.append(f'<rect x="{(xa + xb) / 2 - 20}" y="{yl - 11}" width="40" height="22" rx="3" fill="{lab}"/>'
               f'<text x="{(xa + xb) / 2}" y="{yl + 5}" text-anchor="middle" fill="{fg}" font-size="12.5">vae</text>')
    out.append("</svg>")
    return "\n".join(out) + "\n"


for name, dark in (("quickstart-dark.svg", True), ("quickstart-light.svg", False)):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        f.write(svg(dark))
    print("wrote docs/images/" + name)
