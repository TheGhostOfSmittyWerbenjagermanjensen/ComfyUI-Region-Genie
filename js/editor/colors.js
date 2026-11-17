// Region colors and palettes.

export function hsvHex(h, s, v) {
    const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
    return "#" + [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
export const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(String(h).slice(i, i + 2), 16) || 0);
// sRGB -> CIELAB (D65), for "how different do two colors look"
export function rgbLab([r, g, b]) {
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const [R, G, B] = [lin(r), lin(g), lin(b)];
    const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const rgbHex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("").toUpperCase();

// ---- color palettes (MOSS "palette" / Ideogram "color_palette"); same rules as region_genie.py ----
export const PAL_MAX = 5, PAL_MIN_D2 = 40 * 40;
export function normPalette(p) {
    const out = [];
    for (const c of Array.isArray(p) ? p : []) {
        if (typeof c !== "string") continue;
        let h = c.trim().toUpperCase();
        if (!h.startsWith("#")) h = "#" + h;
        if (/^#[0-9A-F]{6}$/.test(h)) out.push(h);
        if (out.length >= PAL_MAX) break;
    }
    return out;
}
export const activePalette = (r) => (r?.paletteOn ? normPalette(r.palette) : []);
function distinctColor(c, taken) {
    const far = (q) => taken.every((t) => (q[0] - t[0]) ** 2 + (q[1] - t[1]) ** 2 + (q[2] - t[2]) ** 2 >= PAL_MIN_D2);
    if (far(c)) return c;
    for (let k = 1; k < 22; k++) {                       // lighter / darker versions of the same color first
        for (const sign of [1, -1]) {
            const d = 12 * k * sign;
            const q = c.map((v) => Math.min(255, Math.max(0, v + d)));
            if (Math.max(...q) >= 32 && far(q)) return q;
        }
    }
    const tk = new Set(taken.map((t) => t.join(",")));
    const q = [...c];
    let n = 0;
    while (tk.has(q.join(",")) && n < 512) {               // crowded: at least keep it unique
        n += 1;
        q[2] = q[2] < 255 ? q[2] + 1 : q[2] - 1;
        if (n % 2) q[1] = q[1] < 255 ? q[1] + 1 : q[1] - 1;
    }
    return q;
}
// region id -> shown color for regions with a palette (its first color, moved a little when it would look like
// black or another region's color); regions without one keep their own colors, which are reserved first
export function effectiveColors(regions) {
    const taken = [[0, 0, 0]];
    for (const r of regions) if (!activePalette(r).length) taken.push(hexRgb(r.color));
    const out = new Map();
    for (const r of regions) {
        const pal = activePalette(r);
        if (!pal.length) continue;
        let c = hexRgb(pal[0]);
        const m = Math.max(...c);
        if (m < 32) c = c.map((v) => v + 32 - m);
        c = distinctColor(c, taken);
        taken.push(c);
        out.set(r.id, rgbHex(c));
    }
    return out;
}
