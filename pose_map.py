"""
The pose figures of the Region Genie canvas, drawn as an OpenPose skeleton map (what pose ControlNets read).

paint_data "poses": [{id, region, visible, pts: [[x, y] * 18], off: [joint indices]}]. The 18 joints are OpenPose's body
(COCO order): 0 nose, 1 neck, 2-4 right shoulder / elbow / wrist, 5-7 left arm, 8-10 right hip / knee / ankle, 11-13
left leg, 14 right eye, 15 left eye, 16 right ear, 17 left ear ("right" is the person's right). A point is in the same
units as a layer's centre: 1 = the image's shorter side, measured from the image centre. Joints listed in "off" are
hidden (out of view): they aren't drawn, nor are the bones that end in them.

The picture is the standard one (as OpenPose's and controlnet_aux's draw_bodypose): each bone an ellipse in its color at
60 % brightness, each joint a dot in its color, on black.
"""
import math

import numpy as np

LIMBS = [(1, 2), (1, 5), (2, 3), (3, 4), (5, 6), (6, 7), (1, 8), (8, 9), (9, 10), (1, 11), (11, 12), (12, 13),
         (1, 0), (0, 14), (14, 16), (0, 15), (15, 17)]
COLORS = [(255, 0, 0), (255, 85, 0), (255, 170, 0), (255, 255, 0), (170, 255, 0), (85, 255, 0), (0, 255, 0),
          (0, 255, 85), (0, 255, 170), (0, 255, 255), (0, 170, 255), (0, 85, 255), (0, 0, 255), (85, 0, 255),
          (170, 0, 255), (255, 0, 255), (255, 0, 170), (255, 0, 85)]
JOINTS = 18


def figures(pdata, region_ids=None):
    """The figures to draw: shown ones whose region is in region_ids (the regions that are output; None = any).
    Each is a list of 18 points (x, y) in units of the shorter side from the image centre, None for a hidden joint."""
    out = []
    poses = pdata.get("poses") if isinstance(pdata, dict) else None
    for p in poses if isinstance(poses, list) else []:
        if not isinstance(p, dict) or p.get("visible") is False:
            continue
        if region_ids is not None and p.get("region") is not None and p.get("region") not in region_ids:
            continue                                        # (a figure of no region always counts)
        pts = p.get("pts")
        if not isinstance(pts, list) or len(pts) < JOINTS:
            continue
        off = set(p.get("off") or []) if isinstance(p.get("off"), list) else set()
        fig = []
        for k in range(JOINTS):
            q = pts[k]
            try:
                ok = k not in off and len(q) >= 2 and math.isfinite(float(q[0])) and math.isfinite(float(q[1]))
            except (TypeError, ValueError):
                ok = False
            fig.append((float(q[0]), float(q[1])) if ok else None)
        if any(f is not None for f in fig):
            out.append(fig)
    return out


def from_keypoints(frames, width, height):
    """POSE_KEYPOINT (OpenPose frames, as ComfyUI's SDPose nodes and pose preprocessors give them) -> figures, placed on
    this image: the first frame's people, their pixels scaled from the frame's canvas size to width x height. Joints
    without a score (or at 0, 0) are hidden."""
    frame = frames[0] if isinstance(frames, (list, tuple)) and frames else frames
    if not isinstance(frame, dict):
        return []
    try:
        cw, ch = float(frame.get("canvas_width") or width), float(frame.get("canvas_height") or height)
    except (TypeError, ValueError):
        cw, ch = float(width), float(height)
    short = float(min(width, height))
    out = []
    for person in frame.get("people") or []:
        kp = person.get("pose_keypoints_2d") if isinstance(person, dict) else None
        if not isinstance(kp, (list, tuple)) or len(kp) < JOINTS * 3:
            continue
        fig = []
        for k in range(JOINTS):
            try:
                x, y, sc = float(kp[3 * k]), float(kp[3 * k + 1]), float(kp[3 * k + 2])
            except (TypeError, ValueError):
                fig.append(None)
                continue
            if sc <= 0 or not (math.isfinite(x) and math.isfinite(y)) or (x <= 0 and y <= 0):
                fig.append(None)
                continue
            if cw <= 1.5 and ch <= 1.5 and x <= 1.5 and y <= 1.5:          # some nodes give fractions of the image
                x, y = x * cw * width, y * ch * height
            else:
                x, y = x * width / max(cw, 1e-6), y * height / max(ch, 1e-6)
            fig.append(((x - width / 2) / short, (y - height / 2) / short))
        if any(f is not None for f in fig):
            out.append(fig)
    return out


def to_keypoints(figs, width, height):
    """Figures -> POSE_KEYPOINT: one OpenPose frame with every figure as a person (body only; a hidden joint has
    score 0), in pixels of width x height."""
    short = float(min(width, height))
    people = []
    for fig in figs:
        flat = []
        for q in fig:
            flat += [0.0, 0.0, 0.0] if q is None else [width / 2 + q[0] * short, height / 2 + q[1] * short, 1.0]
        people.append({"pose_keypoints_2d": flat, "face_keypoints_2d": None, "hand_left_keypoints_2d": None,
                       "hand_right_keypoints_2d": None, "foot_keypoints_2d": None})
    return [{"canvas_width": int(width), "canvas_height": int(height), "people": people}]


def render(figs, width, height):
    """(H, W, 3) float32 0..1: the skeleton map of the figures, black where there is none."""
    from PIL import Image, ImageDraw
    width, height = int(width), int(height)
    short = min(width, height)
    stick = max(2.0, short / 128.0)                      # 4 px at 512, as in OpenPose's own pictures
    img = Image.new("RGB", (width, height), (0, 0, 0))
    draw = ImageDraw.Draw(img)

    def px(q):
        return (width / 2 + q[0] * short, height / 2 + q[1] * short)
    for fig in figs:
        for (a, b), col in zip(LIMBS, COLORS):
            if fig[a] is None or fig[b] is None:
                continue
            (x1, y1), (x2, y2) = px(fig[a]), px(fig[b])
            cx, cy, half, ang = (x1 + x2) / 2, (y1 + y2) / 2, math.hypot(x2 - x1, y2 - y1) / 2, math.atan2(y2 - y1, x2 - x1)
            ca, sa = math.cos(ang), math.sin(ang)
            poly = []
            for t in range(0, 360, 10):
                ex, ey = half * math.cos(math.radians(t)), stick * math.sin(math.radians(t))
                poly.append((cx + ex * ca - ey * sa, cy + ex * sa + ey * ca))
            draw.polygon(poly, fill=tuple(int(c * 0.6) for c in col))
    for fig in figs:
        for q, col in zip(fig, COLORS):
            if q is None:
                continue
            x, y = px(q)
            draw.ellipse((x - stick, y - stick, x + stick, y + stick), fill=col)
    return np.asarray(img, dtype=np.float32) / 255.0
