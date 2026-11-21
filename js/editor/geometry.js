// Geometry without a node: edge snapping, masks, outlines, shapes, bitmap layers.
import { hexRgb } from "./colors.js";

// magnetic lasso: the strongest edge near a point (image px) in an edge map of the backdrop, or the point itself
export function snapToEdge(edges, x, y, radius) {
    if (!edges) return [x, y];
    const { g, w, h, k, max } = edges;
    const cx = Math.round(x * k), cy = Math.round(y * k), R = Math.max(1, Math.round(radius * k));
    let best = -1, bx = cx, by = cy;
    for (let yy = Math.max(0, cy - R); yy <= Math.min(h - 1, cy + R); yy++) {
        for (let xx = Math.max(0, cx - R); xx <= Math.min(w - 1, cx + R); xx++) {
            const d = Math.hypot(xx - cx, yy - cy);
            if (d > R) continue;
            const s = g[yy * w + xx] * (1 - 0.5 * d / R);
            if (s > best) { best = s; bx = xx; by = yy; }
        }
    }
    if (best < max * 0.08) return [x, y];                 // no clear edge nearby: the pointer as it is
    return [(bx + 0.5) / k, (by + 0.5) / k];
}
// a straight segment from a to b (image px), sampled every `step` px and pulled onto edges
export function snapSegment(edges, a, b, step, radius) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / Math.max(step, 1e-6)));
    const out = [];
    for (let i = 1; i <= n; i++) out.push(snapToEdge(edges, a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, radius));
    return out;
}
// distance (px, chamfer 1 / 1.414) from every pixel to the nearest pixel where src[i] is set; Float32Array
export function distanceMap(src, w, h) {
    const INF = 1e9, D = 1.41421356, d = new Float32Array(w * h);
    for (let i = 0; i < d.length; i++) d[i] = src[i] ? 0 : INF;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + 1);
        if (y > 0) {
            v = Math.min(v, d[i - w] + 1);
            if (x > 0) v = Math.min(v, d[i - w - 1] + D);
            if (x < w - 1) v = Math.min(v, d[i - w + 1] + D);
        }
        d[i] = v;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        let v = d[i];
        if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
        if (y < h - 1) {
            v = Math.min(v, d[i + w] + 1);
            if (x < w - 1) v = Math.min(v, d[i + w + 1] + D);
            if (x > 0) v = Math.min(v, d[i + w - 1] + D);
        }
        d[i] = v;
    }
    return d;
}
// exact squared distance (px², between pixel centres) from every pixel to the nearest pixel where src[i] is set
// (Felzenszwalb & Huttenlocher: one pass along the columns, one along the rows); Float64Array. The chamfer map above
// is only near enough for closing gaps: growing by it cuts every corner off at 45°
export function distanceSq(src, w, h) {
    const INF = 1e20, d = new Float64Array(w * h), n = Math.max(w, h);
    const f = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), out = new Float64Array(n);
    const pass = (len) => {                               // lower envelope of the parabolas f[q] + (x - q)²
        let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
        for (let q = 1; q < len; q++) {
            let s;
            do { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); } while (s <= z[k] && --k >= 0);
            k++; v[k] = q; z[k] = s; z[k + 1] = INF;
        }
        k = 0;
        for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; out[q] = (q - p) * (q - p) + f[p]; }
    };
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) f[y] = src[y * w + x] ? 0 : INF;
        pass(h);
        for (let y = 0; y < h; y++) d[y * w + x] = out[y];
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) f[x] = d[y * w + x];
        pass(w);
        for (let x = 0; x < w; x++) d[y * w + x] = out[x];
    }
    return d;
}
// a 0/1 mask grown (r > 0) or shrunk (r < 0) by r px, measured straight (a round brush of that radius run along the edge)
export function growMask01(mask, w, h, r) {
    if (!r) return mask;
    const out = new Uint8Array(w * h), lim = r * r + 1e-6;
    if (r > 0) {
        const d = distanceSq(mask, w, h);
        for (let i = 0; i < out.length; i++) out[i] = d[i] <= lim ? 1 : 0;
    } else {
        const inv = new Uint8Array(w * h);
        for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
        // the image's border is no edge of the layer: a layer that runs off the image isn't eaten into from there
        const d = distanceSq(inv, w, h);
        for (let i = 0; i < out.length; i++) out[i] = mask[i] && d[i] > lim ? 1 : 0;
    }
    return out;
}

// ---- spline lasso: a closed, smooth curve through the clicked points (or a simplified freehand path) ----
export function dedupe(pts, eps) {
    const out = [];
    for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p); }
    if (out.length > 1) { const a = out[0], b = out[out.length - 1]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps) out.pop(); }
    return out;
}
// Ramer-Douglas-Peucker on a closed path: the few points that keep its shape within eps
export function simplifyClosed(pts, eps) {
    if (pts.length < 5) return pts.slice();
    let far = 0, fd = -1;                                     // split at the point farthest from the first
    pts.forEach((p, i) => { const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]); if (d > fd) { fd = d; far = i; } });
    const rdp = (a) => {
        if (a.length < 3) return a;
        const [x0, y0] = a[0], [x1, y1] = a[a.length - 1];
        const L = Math.hypot(x1 - x0, y1 - y0) || 1e-9;
        let idx = 0, dmax = 0;
        for (let i = 1; i < a.length - 1; i++) {
            const d = Math.abs((y1 - y0) * a[i][0] - (x1 - x0) * a[i][1] + x1 * y0 - y1 * x0) / L;
            if (d > dmax) { dmax = d; idx = i; }
        }
        if (dmax <= eps) return [a[0], a[a.length - 1]];
        const l = rdp(a.slice(0, idx + 1)), r = rdp(a.slice(idx));
        return [...l.slice(0, -1), ...r];
    };
    const one = rdp(pts.slice(0, far + 1)), two = rdp([...pts.slice(far), pts[0]]);
    return [...one.slice(0, -1), ...two.slice(0, -1)];
}
// a freehand path without the hand's jitter: resampled evenly, then averaged around each point (closed path)
export function smoothClosed(pts, spacing, radius) {
    if (pts.length < 4) return pts.slice();
    const ring = [...pts, pts[0]], even = [ring[0]];
    let carry = 0;
    for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = ring[i - 1], [bx, by] = ring[i], L = Math.hypot(bx - ax, by - ay);
        let d = spacing - carry;
        while (d <= L) { even.push([ax + (bx - ax) * d / L, ay + (by - ay) * d / L]); d += spacing; }
        carry = L - (d - spacing);
    }
    const n = even.length, k = Math.max(1, Math.min(Math.floor(n / 6), Math.round(radius / spacing)));
    if (n < 6) return pts.slice();
    const out = [];
    for (let i = 0; i < n; i++) {
        let sx = 0, sy = 0, sw = 0;
        for (let j = -k; j <= k; j++) {
            const w = k + 1 - Math.abs(j), q = even[((i + j) % n + n) % n];
            sx += q[0] * w; sy += q[1] * w; sw += w;
        }
        out.push([sx / sw, sy / sw]);
    }
    return out;
}
// closed centripetal Catmull-Rom spline through pts, sampled about every `step` units
export function closedSpline(pts, step) {
    const n = pts.length;
    if (n < 3) return pts.slice();
    const out = [];
    const P = (i) => pts[((i % n) + n) % n];
    for (let i = 0; i < n; i++) {
        const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
        const tj = (a, b) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
        const t0 = 0, t1 = t0 + tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
        const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        const k = Math.max(4, Math.min(64, Math.ceil(seg / Math.max(step, 1e-6))));
        for (let j = 0; j < k; j++) {
            const t = t1 + (t2 - t1) * (j / k);
            const lerp = (a, b, ta, tb) => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
            const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
            const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
            out.push(lerp(B1, B2, t1, t2));
        }
    }
    return out;
}

// unit-box outline of a base shape (same as shape_verts() in Python). Rounded rectangle: bw x bh is the box (L units)
// and radius the corner radius in % of its shorter side, so corners stay round whatever the box's proportions
export function shapeVerts(kind, sides, bw = 1, bh = 1, radius = 20) {
    if (kind === "rect") return [[0, 0], [1, 0], [1, 1], [0, 1]];
    if (kind === "roundrect") {
        const r = Math.max(0, Math.min(50, Number.isFinite(+radius) ? +radius : 20)) / 100 * Math.min(bw, bh);
        if (r <= 0) return [[0, 0], [1, 0], [1, 1], [0, 1]];
        const rx = r / bw, ry = r / bh, n = 8, out = [];
        for (const [cx, cy, a0] of [[1 - rx, ry, -90], [1 - rx, 1 - ry, 0], [rx, 1 - ry, 90], [rx, ry, 180]]) {
            for (let i = 0; i <= n; i++) {
                const a = (a0 + 90 * i / n) * Math.PI / 180;
                out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
            }
        }
        return out;
    }
    if (kind === "ellipse") {
        const n = 128, out = [];
        for (let i = 0; i < n; i++) out.push([0.5 + 0.5 * Math.cos(2 * Math.PI * i / n), 0.5 + 0.5 * Math.sin(2 * Math.PI * i / n)]);
        return out;
    }
    if (kind === "triangle") return [[0.5, 0], [1, 1], [0, 1]];
    if (kind === "heart") {
        const n = 128, pts = [];
        for (let i = 0; i < n; i++) {
            const t = 2 * Math.PI * i / n;
            pts.push([16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
        }
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        return pts.map(([x, y]) => [(x - x0) / (x1 - x0), (y - y0) / (y1 - y0)]);
    }
    if (kind === "pentagon" || kind === "hexagon") { sides = kind === "pentagon" ? 5 : 6; kind = "polygon"; }
    const n = Math.max(3, Math.min(64, Math.round(sides || 5)));
    const out = [];
    if (kind === "polygon") {
        for (let i = 0; i < n; i++) {
            const a = -Math.PI / 2 + 2 * Math.PI * i / n;
            out.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
        }
    } else if (kind === "star") {
        for (let i = 0; i < 2 * n; i++) {
            const r = i % 2 === 0 ? 0.5 : 0.2, a = -Math.PI / 2 + Math.PI * i / n;
            out.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
        }
    }
    return out;
}

// ---- run-length masks (alternating 0/1 runs, starting with 0; same as decode_runs() in Python)
export function encodeRuns(mask) {
    const runs = [];
    let val = 0, n = 0;
    for (let i = 0; i < mask.length; i++) {
        const v = mask[i] ? 1 : 0;
        if (v === val) n++;
        else { runs.push(n); val = v; n = 1; }
    }
    runs.push(n);
    return runs;
}
export function decodeRuns(runs, n) {
    const mask = new Uint8Array(n);
    let pos = 0, val = 0;
    for (const run of runs || []) { if (val) mask.fill(1, pos, Math.min(n, pos + run)); pos += run; val ^= 1; }
    return mask;
}
export const bitmapCache = new WeakMap();     // op -> {color, canvas}
export function bitmapCanvas(op, color) {
    const c0 = bitmapCache.get(op);
    if (c0 && c0.color === color) return c0.canvas;
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, op.w); cv.height = Math.max(1, op.h);
    const x = cv.getContext("2d"), img = x.createImageData(cv.width, cv.height);
    const [r, g, b] = hexRgb(color);
    let pos = 0, val = 0;
    for (const run of op.runs || []) {
        if (val) for (let i = pos; i < pos + run; i++) { const k = i * 4; img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255; }
        pos += run; val ^= 1;
    }
    x.putImageData(img, 0, 0);
    bitmapCache.set(op, { color, canvas: cv });
    return cv;
}
