// Pose figures (round 61): stick figures on the canvas for pose control (OpenPose's 18 body joints).
// state.poses: [{ id, name, region, visible, pts: [[x, y] * 18], off: [joint indices] }]. A point is in the units of a
// layer's centre: 1 = the image's shorter side, from the image centre (so figures keep their place like layers when
// the size changes). A figure belongs to a region (it is listed with that region's layers, hides with it, and moves
// to the region it is dropped on). Joints in "off" are out of view: not in the control map, nor the bones ending there.
// The Python side (pose_map.py) draws the same figures as the standard OpenPose picture for a Control row "pose".
// Joints (the person's right / left): 0 nose, 1 neck, 2-4 right shoulder / elbow / wrist, 5-7 left arm, 8-10 right hip
// / knee / ankle, 11-13 left leg, 14 right eye, 15 left eye, 16 right ear, 17 left ear.
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { svgIcon, getSetting, SET, SDPOSE_DEFAULT } from "../rg_shared.js";
import { UNSPEC } from "./shared.js";

export const POSE_LIMBS = [[1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10], [1, 11], [11, 12], [12, 13],
                           [1, 0], [0, 14], [14, 16], [0, 15], [15, 17]];
export const POSE_COLORS = ["#ff0000", "#ff5500", "#ffaa00", "#ffff00", "#aaff00", "#55ff00", "#00ff00", "#00ff55", "#00ffaa",
                            "#00ffff", "#00aaff", "#0055ff", "#0000ff", "#5500ff", "#aa00ff", "#ff00ff", "#ff00aa", "#ff0055"];
export const POSE_JOINTS = ["nose", "neck", "right shoulder", "right elbow", "right wrist", "left shoulder", "left elbow", "left wrist",
                            "right hip", "right knee", "right ankle", "left hip", "left knee", "left ankle", "right eye", "left eye",
                            "right ear", "left ear"];
const SWAP = [0, 1, 5, 6, 7, 2, 3, 4, 11, 12, 13, 8, 9, 10, 15, 14, 17, 16];        // each joint's other side

// ---- the starting poses: 18 points each, drawn about 1 unit tall (x right, y down); they are fitted into the box
// that is dragged. A person facing us has their right side on our left.
const FRONT = [[0, .10], [0, .20], [-.11, .21], [-.14, .37], [-.15, .52], [.11, .21], [.14, .37], [.15, .52],
               [-.07, .52], [-.075, .74], [-.08, .96], [.07, .52], [.075, .74], [.08, .96], [-.025, .08], [.025, .08], [-.055, .095], [.055, .095]];
const front = (o) => FRONT.map((p, k) => o[k] || p);
const FAR = [15, 17];                         // seen from the person's right side: the left eye and ear are out of view
export const POSE_PRESETS = [
    ["standing", "Standing", FRONT],
    ["walking", "Walking", [[.045, .105], [0, .20], [-.01, .21], [-.08, .36], [-.04, .50], [.02, .21], [.10, .35], [.17, .47],
        [-.01, .52], [.09, .72], [.07, .95], [.02, .52], [-.04, .74], [-.14, .92], [.03, .085], [.035, .085], [-.015, .10], [-.01, .10]], FAR],
    ["running", "Running", [[.115, .115], [.06, .21], [.05, .22], [-.07, .33], [.03, .40], [.08, .22], [.18, .32], [.24, .20],
        [0, .52], [.16, .66], [.10, .86], [.03, .52], [-.08, .70], [-.24, .72], [.10, .095], [.105, .095], [.055, .115], [.06, .115]], FAR],
    ["jumping", "Jumping", front({ 3: [-.22, .10], 4: [-.26, -.06], 6: [.22, .10], 7: [.26, -.06], 8: [-.07, .50], 9: [-.14, .66], 10: [-.10, .82],
        11: [.07, .50], 12: [.14, .66], 13: [.10, .82] })],
    ["sitting", "Sitting", [[.045, .105], [0, .20], [-.01, .21], [.02, .37], [.14, .46], [.02, .21], [.05, .37], [.17, .46],
        [-.01, .53], [.22, .54], [.23, .80], [.02, .53], [.25, .55], [.26, .80], [.03, .085], [.035, .085], [-.015, .10], [-.01, .10]], FAR],
    ["squatting", "Squatting", [[0, .30], [0, .40], [-.11, .41], [-.17, .54], [-.09, .63], [.11, .41], [.17, .54], [.09, .63],
        [-.07, .68], [-.19, .72], [-.11, .94], [.07, .68], [.19, .72], [.11, .94], [-.025, .28], [.025, .28], [-.055, .295], [.055, .295]]],
    ["crawling", "Crawling", [[.52, .30], [.40, .32], [.38, .33], [.38, .52], [.38, .70], [.42, .33], [.44, .52], [.46, .70],
        [0, .36], [0, .70], [-.22, .70], [.03, .36], [.08, .70], [-.14, .70], [.51, .275], [.515, .275], [.45, .28], [.46, .28]], FAR],
    ["lyingBack", "Lying on the back", [[.02, .44], [.14, .50], [.15, .50], [.30, .53], [.44, .52], [.15, .49], [.30, .50], [.44, .49],
        [.48, .50], [.72, .49], [.96, .51], [.48, .49], [.72, .47], [.96, .49], [.035, .425], [.04, .425], [.06, .47], [.065, .47]], FAR],
    // on the side, towards us: the standing figure turned a quarter (head to the left), the upper arm resting on the hip
    ["lyingSide", "Lying on the side", front({ 3: [-.12, .36], 4: [-.04, .47], 8: [-.06, .52], 9: [-.05, .74], 10: [-.05, .96], 11: [.06, .52], 12: [.01, .73], 13: [-.02, .95] })
        .map(([x, y]) => [y, .5 - x]).map((p, k) => ({ 6: [.36, .36], 7: [.50, .42] })[k] || p)],
    ["oneArm", "One arm raised", front({ 6: [.17, .08], 7: [.19, -.07] })],
    ["bothArms", "Both arms raised", front({ 3: [-.17, .08], 4: [-.19, -.07], 6: [.17, .08], 7: [.19, -.07] })],
    // from behind: the person's right is on our right, and the face is out of view (the ears still show)
    ["facingAway", "Facing away", FRONT.map(([x, y]) => [-x, y]), [0, 14, 15]],
    ["tpose", "T-pose", front({ 3: [-.28, .21], 4: [-.44, .21], 6: [.28, .21], 7: [.44, .21] })],
];
const boxOf = (pts) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    return [x0, y0, x1, y1];
};
// a starting pose fitted into a box (same units as the result), keeping its proportions, in the box's middle
export function presetIn(key, bx0, by0, bx1, by1) {
    const pr = POSE_PRESETS.find((p) => p[0] === key) || POSE_PRESETS[0];
    const [x0, y0, x1, y1] = boxOf(pr[2]), w = Math.max(1e-6, x1 - x0), h = Math.max(1e-6, y1 - y0);
    const k = Math.min(Math.abs(bx1 - bx0) / w, Math.abs(by1 - by0) / h);
    const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
    return { pts: pr[2].map(([x, y]) => [cx + (x - (x0 + x1) / 2) * k, cy + (y - (y0 + y1) / 2) * k]), off: [...(pr[3] || [])] };
}

export function* pose(E) {
    Object.assign(E, { poseAssoc, takePoseInput, poses, posesOf, poseShown, drawPoses, poseDown, poseMove, poseUp, poseRows, deletePose, selectPose,
                       poseStripSync, flipPose, toggleJoint, duplicatePose, poseKey, selPose });
    yield;

    const FROM_IMAGE = "__image__";   // the strip's last entry: the figure is read from the person in the dragged box
    E.poseSel = null;                 // the selected figure's id
    E.poseJoint = null;               // the joint last grabbed in it
    E.posePreset = "standing";

    function poses() { return E.state.poses || []; }
    function posesOf(rid) { return poses().filter((p) => (p.region ?? null) === (rid ?? null)); }        // null: the figures of no region
    function selPose() { return poses().find((p) => p.id === E.poseSel) || null; }
    // a figure of no region is always shown; one of a region is hidden with it
    function poseShown(P) { return P.visible !== false && (P.region == null || (!!E.regionById(P.region) && !E.regionById(P.region).hidden)); }
    const unit = () => { const [W, H] = E.dims(); return [W, H, Math.min(W, H)]; };
    const toImg = (p) => { const [W, H, s] = unit(); return [W / 2 + p[0] * s, H / 2 + p[1] * s]; };
    const fromImg = (ix, iy) => { const [W, H, s] = unit(); return [(ix - W / 2) / s, (iy - H / 2) / s]; };
    const scr = (p) => E.toScr(...toImg(p));
    const offSet = (P) => new Set(P.off || []);
    // the figure's box on screen (its shown joints), with room around it
    function screenBox(P) {
        const off = offSet(P), pts = P.pts.filter((_, k) => !off.has(k)).map(scr), pad = 9 * E.dprNow();
        const [x0, y0, x1, y1] = boxOf(pts.length ? pts : P.pts.map(scr));
        return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
    }
    function handles(P) {
        const [x0, y0, x1, y1] = screenBox(P);
        return [{ kind: "scale", x: x0, y: y0, ax: x1, ay: y1 }, { kind: "scale", x: x1, y: y0, ax: x0, ay: y1 },
                { kind: "scale", x: x0, y: y1, ax: x1, ay: y0 }, { kind: "scale", x: x1, y: y1, ax: x0, ay: y0 },
                { kind: "rotate", x: (x0 + x1) / 2, y: y0 - 20 * E.dprNow() }];
    }
    const segDist = (px, py, a, b) => {
        const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy;
        const t = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / l2)) : 0;
        return Math.hypot(px - a[0] - t * vx, py - a[1] - t * vy);
    };
    // the region under a point of the image, if any
    function regionUnder(ix, iy) {
        const L = E.hitLayer(...E.toScr(ix, iy));
        return L && L.region !== UNSPEC && E.regionById(L.region) ? L.region : null;
    }
    // ---- which region a figure belongs to (the owner's rule, round 64): the region under its middle (the point
    // between neck and hips); over no region, none. A figure of no region still counts for the pose map: the scene
    // prompt describes its character. Looked up whenever the editor saves (save() in regions.js), so moving a region
    // under a figure counts as much as moving the figure. A hidden figure, and one of a hidden region, keeps what it has.
    function poseAssoc() {
        if (!E.poseReady) return 0;
        let n = 0;
        for (const P of poses()) {
            if (P.visible === false || (P.region != null && E.regionById(P.region)?.hidden)) continue;
            let r = null;
            try { r = regionUnder(...toImg(middle(P))); } catch (e) { continue; }
            if ((P.region ?? null) !== r) { P.region = r; n++; }
        }
        return n;
    }
    // new figures (drawn, read from the image, taken from the input): one Undo step; the last one is selected
    function addFigures(figs, before) {
        if (!figs.length) return;
        E.state.poses = [...poses(), ...figs];
        E.pushUndo(before); E.save();
        const last = poses().find((p) => p.id === figs[figs.length - 1].id);
        if (last?.region != null) E.openSub?.(last.region, "layers");
        E.refreshUI();
        selectPose(last);
    }
    const middle = (P) => { const q = [1, 8, 11].map((k) => P.pts[k]); return [(q[0][0] + q[1][0] + q[2][0]) / 3, (q[0][1] + q[1][1] + q[2][1]) / 3]; };
    const nextId = () => poses().reduce((m, p) => Math.max(m, +p.id || 0), 0) + 1;

    function selectPose(P, joint = null) {
        E.poseSel = P ? P.id : null; E.poseJoint = P ? joint : null;
        if (P) {
            if (E.tool !== "pose") E.setTool("pose");
            if (P.region != null && E.curRegion !== P.region) E.activateRegion(P.region);
        }
        E.markPoseRows?.(); poseStripSync(); E.requestDraw();
    }
    function deletePose(P = selPose()) {
        if (!P) return false;
        E.change(() => { E.state.poses = poses().filter((p) => p !== P); if (!E.state.poses.length) delete E.state.poses; });
        if (E.poseSel === P.id) { E.poseSel = null; E.poseJoint = null; }
        poseStripSync();
        return true;
    }
    function duplicatePose(P = selPose()) {
        if (!P) return false;
        const d = 0.04, id = nextId();
        E.change(() => { E.state.poses = [...poses(), { ...P, id, name: `Pose ${id}`, pts: P.pts.map(([x, y]) => [x + d, y + d]), off: [...(P.off || [])] }]; });
        selectPose(poses().find((p) => p.id === id));
        return true;
    }
    // mirror the figure left-right about its middle: a mirrored person's right arm is where the left one was
    function flipPose(P = selPose()) {
        if (!P) return;
        const [x0, , x1] = boxOf(P.pts), cx = (x0 + x1) / 2, off = offSet(P);
        E.change(() => {
            const pts = P.pts.map((_, k) => { const q = P.pts[SWAP[k]]; return [2 * cx - q[0], q[1]]; });
            P.pts = pts; P.off = [...off].map((k) => SWAP[k]).sort((a, b) => a - b);
            if (!P.off.length) delete P.off;
        });
        if (E.poseJoint != null) E.poseJoint = SWAP[E.poseJoint];
        poseStripSync();
    }
    // a joint out of view (behind something, or outside the picture): hidden from the control map, and back
    function toggleJoint(P = selPose(), k = E.poseJoint) {
        if (!P || k == null) { E.hint("Click a joint of the figure first"); return; }
        const off = offSet(P);
        E.change(() => { if (off.has(k)) off.delete(k); else off.add(k); P.off = [...off].sort((a, b) => a - b); if (!P.off.length) delete P.off; });
        E.hint(`${POSE_JOINTS[k][0].toUpperCase()}${POSE_JOINTS[k].slice(1)}: ${off.has(k) ? "Hidden (not in the pose map)" : "Shown again"}`);
        poseStripSync();
    }
    // keys while the Pose tool is in use; true when the key was taken
    function poseKey(what) {
        if (E.tool !== "pose") return false;
        const P = selPose();
        if (what === "delete") return deletePose(P);
        if (what === "duplicate") return duplicatePose(P);
        if (what === "deselect") { if (!P) return false; selectPose(null); return true; }
        return false;
    }

    // ---- the pointer (called by pointer.js while the Pose tool is the tool) ----
    function poseDown(e, dx, dy, ix, iy, before) {
        const dpr = E.dprNow(), sel = selPose();
        if (sel && poseShown(sel)) {
            const hd = handles(sel).find((h) => Math.hypot(h.x - dx, h.y - dy) <= 9 * dpr);
            if (hd) {
                const [x0, y0, x1, y1] = boxOf(sel.pts.map(toImg));
                if (hd.kind === "rotate") {
                    const c = [(x0 + x1) / 2, (y0 + y1) / 2];
                    E.drag = { mode: "poseRot", P: sel, pts0: sel.pts.map((p) => [...p]), c, a0: Math.atan2(iy - c[1], ix - c[0]), before };
                } else {
                    const A = E.toImg(hd.ax, hd.ay);                 // the opposite corner stays where it is
                    E.drag = { mode: "poseScale", P: sel, pts0: sel.pts.map((p) => [...p]), A, start: [ix, iy], before };
                }
                return;
            }
        }
        const order = [...poses()].reverse().filter(poseShown).sort((a, b) => (b === sel) - (a === sel));
        for (const P of order) {                               // a joint: drag it
            const off = offSet(P);
            for (let k = P.pts.length - 1; k >= 0; k--) {
                if (off.has(k) && P !== sel) continue;
                const [x, y] = scr(P.pts[k]);
                if (Math.hypot(x - dx, y - dy) <= 8 * dpr) {
                    selectPose(P, k);
                    E.drag = { mode: "poseJoint", P, k, before, moved: false };
                    return;
                }
            }
        }
        for (const P of order) {                               // a bone, or inside the selected figure's box: move the figure
            const off = offSet(P);
            const onBone = POSE_LIMBS.some(([a, b]) => !off.has(a) && !off.has(b) && segDist(dx, dy, scr(P.pts[a]), scr(P.pts[b])) <= 7 * dpr);
            const [x0, y0, x1, y1] = P === sel ? screenBox(P) : [1, 1, 0, 0];
            if (onBone || (dx >= x0 && dx <= x1 && dy >= y0 && dy <= y1)) {
                selectPose(P, P === sel ? E.poseJoint : null);
                E.drag = { mode: "poseMove", P, pts0: P.pts.map((p) => [...p]), start: [ix, iy], before, moved: false };
                return;
            }
        }
        E.drag = { mode: "poseBox", start: [ix, iy], cur: [ix, iy], sd: [dx, dy], moved: 0, before };
    }
    function poseMove(e, dx, dy, ix, iy) {
        const d = E.drag, [, , s] = unit();
        if (d.mode === "poseBox") { d.cur = [ix, iy]; d.moved = Math.max(d.moved, Math.hypot(dx - d.sd[0], dy - d.sd[1])); }
        else if (d.mode === "poseJoint") { d.P.pts[d.k] = fromImg(ix, iy); d.moved = true; }
        else if (d.mode === "poseMove") {
            const ox = (ix - d.start[0]) / s, oy = (iy - d.start[1]) / s;
            d.P.pts = d.pts0.map(([x, y]) => [x + ox, y + oy]); d.moved = d.moved || Math.hypot(ox, oy) * s * E.view.z > 2;
        } else if (d.mode === "poseRot") {
            let a = Math.atan2(iy - d.c[1], ix - d.c[0]) - d.a0;
            if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
            const ca = Math.cos(a), sa = Math.sin(a), c = fromImg(...d.c);
            d.P.pts = d.pts0.map(([x, y]) => [c[0] + (x - c[0]) * ca - (y - c[1]) * sa, c[1] + (x - c[0]) * sa + (y - c[1]) * ca]);
            d.moved = true;
        } else if (d.mode === "poseScale") {
            // the same factor both ways, so the figure keeps its proportions (Shift: each way on its own)
            const fx0 = (ix - d.A[0]) / ((d.start[0] - d.A[0]) || 1e-6), fy0 = (iy - d.A[1]) / ((d.start[1] - d.A[1]) || 1e-6);
            const f = Math.max(0.05, Math.max(fx0, fy0)), fx = e.shiftKey ? Math.max(0.05, fx0) : f, fy = e.shiftKey ? Math.max(0.05, fy0) : f;
            const a = fromImg(...d.A);
            d.P.pts = d.pts0.map(([x, y]) => [a[0] + (x - a[0]) * fx, a[1] + (y - a[1]) * fy]);
            d.moved = true;
        }
        E.requestDraw();
    }
    function poseUp(d) {
        if (d.mode === "poseBox") {
            if (d.moved < 6 * E.dprNow()) { if (E.poseSel != null) selectPose(null); else E.hint("Drag a box: A figure is drawn into it"); E.requestDraw(); return; }
            if (E.posePreset === FROM_IMAGE) { poseFromImage(d); return; }
            const a = fromImg(...d.start), b = fromImg(...d.cur);
            const id = nextId(), fig = presetIn(E.posePreset, a[0], a[1], b[0], b[1]);
            addFigures([{ id, name: `Pose ${id}`, region: null, visible: true, pts: fig.pts, ...(fig.off.length ? { off: fig.off } : {}) }], d.before);
            return;
        }
        if (!d.moved) { E.requestDraw(); return; }
        const was = d.P.region ?? null;
        E.pushUndo(d.before); E.save();                        // (save() looks up each figure's region: poseAssoc)
        const to = d.P.region ?? null;
        if (to !== was) {
            if (to != null) { E.activateRegion(to); E.openSub?.(to, "layers"); }
            E.hint(to != null ? `The figure now belongs to region ${E.state.regions.findIndex((r) => r.id === to)}` : "The figure's middle is over no region: It belongs to none now (the scene prompt describes it)");
        }
        E.refreshUI(); poseStripSync();
    }

    // ---- From the image: ComfyUI's pose detector (SDPose, pose_detect.py) on the person in the dragged box ----
    E.poseBusy = false;
    async function poseFromImage(d) {
        if (!E.backdrop || !E.backdropRef) { E.hint("Pose from the image " + E.NEEDS_IMAGE); E.requestDraw(); return; }
        if (E.poseBusy) return;
        const [W, H, s] = unit();
        const x0 = Math.min(d.start[0], d.cur[0]), x1 = Math.max(d.start[0], d.cur[0]), y0 = Math.min(d.start[1], d.cur[1]), y1 = Math.max(d.start[1], d.cur[1]);
        const mid = [(x0 + x1) / 2, (y0 + y1) / 2];
        E.poseBusy = true; E.hint("Reading the pose …"); E.requestDraw();
        try {
            const r = await api.fetchApi("/region_genie/pose_detect", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image: E.backdropRef, box: [x0 / W, y0 / H, x1 / W, y1 / H], model: getSetting(SET.poseModel, SDPOSE_DEFAULT) }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || j.error) { E.hint(""); E.showMsg(j.error || `Pose from the image failed (${r.status})`); return; }
            const person = (j.people || [])[0];
            const pts = person?.pts?.map(([x, y]) => fromImg(x * W, y * H));
            // a joint the detector isn't sure of (or didn't find) starts hidden; its place: its neighbour's, so it can be shown and dragged
            const off = (person?.scores || []).map((sc, k) => (sc < 0.3 ? k : -1)).filter((k) => k >= 0);
            if (!pts || pts.length < 18 || off.length >= 14) { E.hint("No person found in that box: Drag it around one person"); return; }
            const seen = pts.filter((_, k) => !off.includes(k)), c = [seen.reduce((a, p) => a + p[0], 0) / seen.length, seen.reduce((a, p) => a + p[1], 0) / seen.length];
            for (const k of off) pts[k] = [c[0], c[1]];
            const id = nextId();
            addFigures([{ id, name: `Pose ${id}`, region: null, visible: true, pts, ...(off.length ? { off } : {}) }], E.snapshot());
            E.hint(off.length ? `Pose read; ${off.length} joint(s) it couldn't see are hidden` : "Pose read from the image");
        } catch (e) {
            E.hint(""); E.showMsg("Pose from the image: no answer from the server (" + (e?.message || e) + ")");
        } finally { E.poseBusy = false; E.requestDraw(); void s; }
    }

    // ---- the pose_keypoint input's figures onto the canvas (round 64): the strip's import button ----
    // The keypoints only exist once the nodes before the input have run, so the button queues a small prompt of its
    // own: those nodes and nothing after them, plus the pack's internal node "Region-Genie_PoseFetch", which hands
    // the people back as its run message. The sampler and the rest of the workflow don't run.
    // A placed figure remembers which of the input's figures it is (src.sig) and how it looked when placed (src.own):
    //   - an input figure with an unchanged copy on the canvas is skipped;
    //   - one whose copy the user changed is placed again (Setting: next to the changed one, or in its place);
    //   - one the input changed (no copy has its pose; an earlier figure has its place in the input): Setting too.
    // After the first import the node's data says so (poseInputTaken) and a run uses the canvas's figures only.
    const sigOf = (pts, off) => JSON.stringify([pts.map(([x, y]) => [Math.round(x * 1e4), Math.round(y * 1e4)]), [...(off || [])].sort((a, b) => a - b)]);
    E.poseTaking = false;
    async function takePoseInput() {
        if (!E.isLinked("pose_keypoint")) { E.hint("Connect a node to the pose_keypoint input first (tick it in the sockets list of the size row)"); return; }
        if (E.poseTaking) return;
        E.poseTaking = true; E.hint("Getting the input's figures …"); poseStripSync();
        try {
            const p = await app.graphToPrompt(), out = p?.output || {};
            const me = String(E.node.id);
            const key = out[me] ? me : Object.keys(out).find((k) => k.split(":").pop() === me && out[k].class_type === "Region-Genie_Main");
            const link = out[key]?.inputs?.pose_keypoint;
            if (!Array.isArray(link)) { E.hint("The pose_keypoint input has nothing connected that can run"); return; }
            const need = {};
            const walk = (id) => {
                id = String(id);
                if (need[id] || !out[id]) return;
                need[id] = out[id];
                for (const v of Object.values(out[id].inputs || {})) if (Array.isArray(v) && v.length === 2 && out[String(v[0])]) walk(v[0]);
            };
            walk(link[0]);
            const fid = `rgpose${me}x${Date.now()}`;
            need[fid] = { class_type: "Region-Genie_PoseFetch", inputs: { keypoints: link, nonce: String(Date.now()) } };
            const people = await new Promise((resolve, reject) => {
                let pid = null;
                const done = (fn, v) => { api.removeEventListener("executed", onEx); api.removeEventListener("execution_error", onErr); clearTimeout(t); fn(v); };
                const onEx = (e) => { if (String(e.detail?.node) === fid || String(e.detail?.display_node) === fid) done(resolve, e.detail.output?.pose_people || []); };
                const onErr = (e) => { if (!pid || e.detail?.prompt_id === pid) done(reject, new Error(e.detail?.exception_message || "the nodes that make the keypoints stopped with an error")); };
                const t = setTimeout(() => done(reject, new Error("no answer after 10 minutes")), 600000);
                api.addEventListener("executed", onEx); api.addEventListener("execution_error", onErr);
                Promise.resolve(api.queuePrompt(0, { output: need, workflow: p.workflow })).then((r) => { pid = r?.prompt_id || null; }, (err) => done(reject, err));
            });
            placeInput(people);
        } catch (e) {
            E.hint(""); E.showMsg("Pose figures from the input: " + (e?.response?.error?.message || e?.message || e));
        } finally { E.poseTaking = false; poseStripSync(); }
    }
    // people: [{ pts: 18 x [x, y] as fractions of their canvas, scores: [18] }]
    function placeInput(people) {
        const [W, H] = unit(), figs = poses(), before = E.snapshot();
        const keepChanged = getSetting(SET.poseOnChanged, "keep") !== "replace", keepStale = getSetting(SET.poseOnInput, "keep") !== "replace";
        const items = [];
        (people || []).forEach((pp, i) => {
            if (!Array.isArray(pp?.pts) || pp.pts.length < 18) return;
            const off = (pp.scores || []).map((sc, k) => (sc < 0.3 ? k : -1)).filter((k) => k >= 0);
            if (off.length >= 14) return;
            const pts = pp.pts.slice(0, 18).map(([x, y]) => fromImg(x * W, y * H));
            const seen = pts.filter((_, k) => !off.includes(k)), c = [seen.reduce((a, q) => a + q[0], 0) / seen.length, seen.reduce((a, q) => a + q[1], 0) / seen.length];
            for (const k of off) pts[k] = [c[0], c[1]];           // a joint the input doesn't have: hidden, at the figure's middle
            items.push({ i, sig: sigOf(pp.pts.slice(0, 18), off), pts, off });
        });
        if (!items.length) { E.hint("The pose_keypoint input has no figure"); return; }
        const sigs = new Set(items.map((x) => x.sig));
        const added = [];
        let replaced = 0, same = 0, id = nextId(), last = null;
        for (const it of items) {
            const src = { i: it.i, sig: it.sig, own: sigOf(it.pts, it.off) };
            const copies = figs.filter((f) => f.src?.sig === it.sig);
            if (copies.some((f) => sigOf(f.pts, f.off) === f.src.own)) { same++; continue; }       // an unchanged copy is on the canvas
            const target = copies.length ? (keepChanged ? null : copies[0])                           // the user changed the copy
                : (keepStale ? null : figs.find((f) => f.src && f.src.i === it.i && !sigs.has(f.src.sig)) || null);   // the input changed this figure
            if (target) {
                target.pts = it.pts.map((q) => [...q]); if (it.off.length) target.off = [...it.off]; else delete target.off;
                target.src = src; replaced++; last = target;
            } else {
                added.push({ id, name: `Pose ${id}`, region: null, visible: true, pts: it.pts, ...(it.off.length ? { off: it.off } : {}), src });
                id++;
            }
        }
        if (!added.length && !replaced) { E.hint("Nothing new: The canvas already has the input's figures, unchanged"); return; }
        E.state.poseInputTaken = true;
        E.state.poses = [...poses(), ...added];
        E.pushUndo(before); E.save();
        last = added.length ? poses().find((q) => q.id === added[added.length - 1].id) : last;
        if (last?.region != null) E.openSub?.(last.region, "layers");
        E.refreshUI(); selectPose(last);
        E.hint(`${added.length ? `${added.length} figure(s) placed` : ""}${added.length && replaced ? ", " : ""}${replaced ? `${replaced} replaced` : ""}${same ? `, ${same} already there` : ""}. A run now uses the canvas's figures, not the input`);
    }
    E.placePoseInput = placeInput;       // (tests)

    // ---- drawing on the canvas (render.js calls it after the layers and labels) ----
    function drawFigure(ctx, P, o = {}) {
        const dpr = E.dprNow(), off = o.off || offSet(P), pts = P.pts.map(scr), a = o.alpha ?? 1;
        ctx.save(); ctx.lineCap = "round"; ctx.globalAlpha = a;
        POSE_LIMBS.forEach(([i, j], k) => {
            if (off.has(i) || off.has(j)) return;
            ctx.beginPath(); ctx.moveTo(...pts[i]); ctx.lineTo(...pts[j]);
            ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.lineWidth = 6.5 * dpr; ctx.stroke();
            ctx.strokeStyle = POSE_COLORS[k]; ctx.lineWidth = 4 * dpr; ctx.stroke();
        });
        pts.forEach(([x, y], k) => {
            const r = (k >= 14 ? 2.8 : 4.4) * dpr;
            if (off.has(k)) {
                if (!o.selected) return;                        // a hidden joint: a hollow ring, only on the selected figure
                ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.setLineDash([2 * dpr, 2 * dpr]); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.3 * dpr; ctx.stroke(); ctx.setLineDash([]);
                return;
            }
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = POSE_COLORS[k]; ctx.fill(); ctx.strokeStyle = "#000"; ctx.lineWidth = 1.2 * dpr; ctx.stroke();
        });
        ctx.restore();
    }
    function drawPoses() {
        const ctx = E.ctx, dpr = E.dprNow(), active = E.tool === "pose", sel = active ? selPose() : null;
        for (const P of poses()) if (poseShown(P)) drawFigure(ctx, P, { selected: P === sel, alpha: active ? 1 : 0.8 });
        if (sel && poseShown(sel)) {
            const [x0, y0, x1, y1] = screenBox(sel);
            ctx.save();
            ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2 * dpr; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo((x0 + x1) / 2, y0); ctx.lineTo((x0 + x1) / 2, y0 - 20 * dpr); ctx.stroke();
            for (const h of handles(sel)) {
                ctx.fillStyle = h.kind === "rotate" ? "#5b8fd0" : "#fff"; ctx.strokeStyle = "#1d3d66"; ctx.lineWidth = 1.5 * dpr;
                ctx.beginPath();
                if (h.kind === "rotate") ctx.arc(h.x, h.y, 5 * dpr, 0, Math.PI * 2); else ctx.rect(h.x - 4 * dpr, h.y - 4 * dpr, 8 * dpr, 8 * dpr);
                ctx.fill(); ctx.stroke();
            }
            if (E.poseJoint != null) {
                const [x, y] = scr(sel.pts[E.poseJoint]);
                ctx.beginPath(); ctx.arc(x, y, 8 * dpr, 0, Math.PI * 2); ctx.strokeStyle = "#ffd54a"; ctx.lineWidth = 2.2 * dpr; ctx.stroke();
            }
            ctx.restore();
        }
        const d = E.drag;
        if (d?.mode === "poseBox" && d.moved >= 6 * dpr) {       // the box being dragged, with the figure it will hold
            const [ax, ay] = E.toScr(...d.start), [bx, by] = E.toScr(...d.cur);
            ctx.save(); ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2 * dpr;
            ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)); ctx.restore();
            if (E.posePreset !== FROM_IMAGE) {
                const a = fromImg(...d.start), b = fromImg(...d.cur), fig = presetIn(E.posePreset, a[0], a[1], b[0], b[1]);
                drawFigure(ctx, { pts: fig.pts }, { off: new Set(fig.off), alpha: 0.85 });
            }
        }
    }

    // ---- the tool's strip on the canvas: the starting pose for new figures; flip and hide a joint of the selected one
    const strip = E.el("div", "rg-poseopts"); strip.style.display = "none";
    for (const ev of ["pointerdown", "mousedown", "click", "dblclick", "wheel", "contextmenu", "keydown"]) strip.addEventListener(ev, (e) => e.stopPropagation());
    const lab = E.el("span", "rg-optlab"); lab.innerHTML = svgIcon("pose");
    const preSel = E.el("select", "rg-sel");
    preSel.title = "The pose a new figure starts in: Drag a box on the canvas and the figure is drawn into it. Every joint can be dragged afterwards.\n"
        + "From the image: Drag the box around a person in the image under the canvas, and the figure takes that person's pose (needs the SDPose model: Settings > Region Genie > Control).";
    lab.title = preSel.title;
    for (const [key, label] of POSE_PRESETS) { const o = E.el("option"); o.value = key; o.textContent = label; preSel.appendChild(o); }
    { const o = E.el("option"); o.value = FROM_IMAGE; o.textContent = "From the image: drag a box around a person"; preSel.appendChild(o); }
    preSel.addEventListener("change", () => { E.posePreset = preSel.value; E.focusSink(); });
    const sBtn = (icon, title, fn) => { const b = E.btn(icon, title, () => { fn(); E.focusSink(); }); b.classList.add("icon"); return b; };
    const flipBtn = sBtn("@flipH", "Flip the selected figure left to right", () => flipPose());
    const jointBtn = sBtn("@eyeOff", "", () => toggleJoint());
    const dupBtn = sBtn("@copy", "Duplicate the selected figure (Ctrl+D)", () => duplicatePose());
    const delBtn = sBtn("@clear", "Delete the selected figure (Delete)", () => deletePose());
    const takeBtn = sBtn("@download", "", () => takePoseInput());
    const TAKE_TIP = "Take the figures of the pose_keypoint input onto the canvas, as figures you can edit. Only the nodes that make the keypoints run, not the whole workflow.\n"
        + "Figures taken before and unchanged are skipped. One you changed, or one the input changed, is placed again (Settings > Region Genie > Region Genie node: Keep or replace).\n"
        + "After this a run uses the canvas's figures; the input itself is no longer used.";
    strip.append(lab, preSel, takeBtn, flipBtn, jointBtn, dupBtn, delBtn);
    function poseStripSync() {
        if (!E.poseReady) return;                      // called by parts that run before this one
        if (!strip.parentElement && E.optStrip?.parentElement) E.optStrip.parentElement.appendChild(strip);
        const on = E.tool === "pose", P = on ? selPose() : null;
        const show = on ? "" : "none";
        if (strip.style.display !== show) strip.style.display = show;
        if (!on) return;
        if (document.activeElement !== preSel) preSel.value = E.posePreset;
        for (const b of [flipBtn, dupBtn, delBtn]) b.disabled = !P;
        const linked = E.isLinked("pose_keypoint");
        takeBtn.disabled = !linked || E.poseTaking;
        const tip = linked ? TAKE_TIP : "Take the figures of the pose_keypoint input onto the canvas: Tick pose_keypoint in the sockets list (the cable button of the size row) and connect a pose node to it first.";
        if (takeBtn.title !== tip) takeBtn.title = tip;
        const k = P ? E.poseJoint : null, off = P && k != null && offSet(P).has(k);
        jointBtn.disabled = k == null;
        jointBtn.classList.toggle("on", !!off);
        jointBtn.title = k == null ? "Hide a joint that is out of view: Click the joint first. A hidden joint and its bones are left out of the pose map."
            : off ? `Show the ${POSE_JOINTS[k]} again` : `Hide the ${POSE_JOINTS[k]} (out of view): It and its bones are left out of the pose map`;
    }

    // ---- the figures of a region in the list, with its layers (list.js calls it; ico() is the list's button maker)
    function poseRows(rid, ico) {
        const frag = document.createDocumentFragment();
        for (const P of [...posesOf(rid)].reverse()) {
            const row = E.el("div", "rg-row lvl1 layer pose" + (P.id === E.poseSel && E.tool === "pose" ? " sel" : ""));
            row.dataset.pid = String(P.id);
            row.addEventListener("pointerdown", (e) => { if (e.target === row || e.target.classList.contains("rg-sw") || e.target.closest(".rg-pose-ic")) selectPose(P); });
            const sp = E.el("span", "rg-pose-ic"); sp.innerHTML = svgIcon("pose"); sp.title = "A pose figure (the Pose tool): Select it";
            const eye = ico(P.visible === false ? "@eyeOff" : "@eye", "Show / hide (a hidden figure is left out of the pose map)", () => E.change(() => { P.visible = P.visible === false; }));
            const sw = E.el("div", "rg-sw"); sw.style.background = E.colorOf(P.region) || "transparent"; sw.title = "Select this figure";
            const name = E.el("input"); name.type = "text"; name.value = P.name || `Pose ${P.id}`; name.title = "Figure name";
            name.addEventListener("focus", () => { if (E.poseSel !== P.id || E.tool !== "pose") selectPose(P); });
            name.addEventListener("change", () => E.change(() => { P.name = name.value; }));
            name.addEventListener("keydown", (e) => e.stopPropagation());
            const flip = ico("@flipH", "Flip left to right", () => flipPose(P));
            const dup = ico("@copy", "Duplicate", () => duplicatePose(P));
            const del = ico("@clear", "Delete this figure", () => deletePose(P));
            row.append(sp, eye, sw, name, flip, dup, del);
            frag.appendChild(row);
        }
        return frag;
    }
    E.poseReady = true;
    E.markPoseRows = () => {
        for (const row of E.regList?.querySelectorAll(".rg-row.pose") || []) row.classList.toggle("sel", E.tool === "pose" && +row.dataset.pid === E.poseSel);
    };
}
