#!/usr/bin/env python3
"""tools/look.py — restyle ink-studio's OWN frames instead of re-rendering them.

The studio does the hard part (animation, bones, dabs, palette, ink detail). We keep that and run
our measured pixel law over its output: OKLab cel bands -> step-17 lattice quantisation with
bayer-4 dither at one lattice step -> 1px ink outline -> nearest-neighbour upscale, no AA.

Input: JSON dumped by tools/frames-dump.js ({frames:[{label, rgb: base64(RGB8), w, h, ...}]}).
Output, per scene in --out-dir:
  raw/<label>.png    the studio frame, untouched
  look/<label>.png   the same frame after our filters
  contact.png        before | after strips, labelled
  zoom.png           3x nearest crop of both, so the lattice/dither is visible
  audit.json         before/after metrics per frame (measure_frames.py instrument)
usage: /usr/bin/python3 tools/look.py --frames studio/out/frames-bench.json [--label bench]
       [--levels 16] [--bands 3] [--contrast 1.0] [--dither bayer-4] [--dither-strength 1.0]
       [--outline] [--outline-color 12,12,20] [--target 600] [--bg-threshold 0.12]
"""
import argparse
import base64
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SPLAT = os.path.expanduser("~/SafeHouse/Games/sdf-splat-pixel")
sys.path.insert(0, os.path.join(SPLAT, "tools"))          # measure_frames
sys.path.insert(0, SPLAT)                                 # render_pixel helpers
from ink_parity import audit                                  # noqa: E402  coverage/lum/lattice/dither/outline
from measure_frames import block_size                         # noqa: E402  measured pixel block
from render_pixel import add_outline, pixelate, posterize_oklab, quantize_lattice  # noqa: E402


def frame_array(fr):
    a = np.frombuffer(base64.b64decode(fr["rgb"]), dtype=np.uint8)
    return a.reshape(fr["h"], fr["w"], 3)


def save_png(path, arr01):
    Image.fromarray((np.clip(arr01, 0, 1) * 255 + 0.5).astype(np.uint8)).save(path)


def metrics(arr01):
    u8 = (np.clip(arr01, 0, 1) * 255 + 0.5).astype(np.uint8)
    m = audit(u8)
    m = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in m.items()}
    m["block"] = block_size(np.asarray(Image.fromarray(u8).convert("RGB")))
    return m


def inner_edge(mask, threshold=0.5):
    """1px inner silhouette edge, numpy only.

    render_pixel.add_outline needs scipy and silently returns the image untouched when scipy is
    missing — which is the case on this machine's system python, so the ink pass was a no-op here.
    Same semantics (solid pixels with at least one non-solid 4-neighbour), no dependency.
    """
    solid = mask > threshold
    if not solid.any():
        return solid
    er = solid.copy()                      # erode by one pixel in 4 directions
    er[1:, :] &= solid[:-1, :]
    er[:-1, :] &= solid[1:, :]
    er[:, 1:] &= solid[:, :-1]
    er[:, :-1] &= solid[:, 1:]
    return solid & ~er


def outline_own(im, msk, levels, steps=1):
    """Edge pixels become a darker shade of their OWN colour, snapped to the lattice below.

    The reference look has no universal ink colour: each material's edge is one ramp step down
    from its own fill. Snapping to the lattice step (not an arbitrary multiply) keeps the frame
    on-lattice afterwards, which the audit checks.
    """
    inner = inner_edge(msk)
    out = im.copy()
    if inner.any():
        step = steps / max(1, levels - 1)
        v = np.clip(im[inner] - step, 0.0, 1.0)
        out[inner] = np.round(v * (levels - 1)) / (levels - 1)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", required=True, help="JSON from tools/frames-dump.js")
    ap.add_argument("--label", default=None)
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--levels", type=int, default=16, help="lattice levels per channel (16 == step 17/255)")
    ap.add_argument("--bands", type=int, default=3, help="OKLab lightness bands (corpus: 3)")
    ap.add_argument("--contrast", type=float, default=1.0)
    ap.add_argument("--dither", default="bayer-4", choices=["none", "bayer-2", "bayer-4", "bayer-8"])
    ap.add_argument("--dither-strength", type=float, default=1.0, help="corpus: one full lattice step")
    ap.add_argument("--outline", action="store_true", default=True)
    ap.add_argument("--no-outline", dest="outline", action="store_false")
    ap.add_argument("--outline-color", default="12,12,20")
    ap.add_argument("--outline-mode", default="own", choices=["own", "ink"],
                    help="own = edge is a darker shade of its own colour (the reference look);\n"
                         "ink = one universal outline colour (render_pixel's add_outline look)")
    ap.add_argument("--outline-steps", type=int, default=1,
                    help="how many lattice steps darker an 'own' outline sits")
    ap.add_argument("--target", type=int, default=600, help="nearest-upscale long edge (no AA)")
    ap.add_argument("--bg-threshold", type=float, default=0.12, help="distance from modal border colour")
    ap.add_argument("--zoom", type=int, default=3)
    ap.add_argument("--cell-px", dest="cell", type=int, default=8,
                    help="wanted lattice cell in screen px, always >= the studio dab block (px).\n"
                         "Cells bigger than the block mean voting dabs together onto one lattice colour.")
    args = ap.parse_args()

    d = json.load(open(args.frames))
    label = args.label or d.get("id") or "scene"
    outdir = os.path.abspath(args.out_dir or os.path.join(ROOT, "studio/out/look", label))
    for sub in ("raw", "look"):
        os.makedirs(os.path.join(outdir, sub), exist_ok=True)

    oc = tuple(int(v) / 255 for v in args.outline_color.split(","))
    audit = {"scene": label, "name": d.get("name"), "filters": {
        "levels": args.levels, "bands": args.bands, "contrast": args.contrast,
        "dither": args.dither, "dither_strength": args.dither_strength,
        "outline": args.outline, "outline_color": args.outline_color, "target": args.target,
        "outline_mode": args.outline_mode, "outline_steps": args.outline_steps,
        "cell": args.cell},
        "frames": []}
    strips_raw, strips_look, zoom_raw, zoom_look = [], [], [], []

    for fr in d["frames"]:
        a = frame_array(fr).astype(np.float32) / 255.0
        h, w, _ = a.shape
        # background = modal colour along the border ring, mask = subject
        ring = np.concatenate([a[0, :, :], a[-1, :, :], a[:, 0, :], a[:, -1, :]])
        cols, cnts = np.unique(ring.round(2).reshape(-1, 3), axis=0, return_counts=True)
        bg = cols[int(np.argmax(cnts))]
        mask = (np.abs(a - bg).max(axis=2) > args.bg_threshold).astype(np.float32)

        # our measured law, in order: cel bands -> lattice+dither -> ink outline -> nearest upscale
        step1 = posterize_oklab(a, mask, bands=args.bands, contrast=args.contrast)
        step2, pal = quantize_lattice(step1, mask, levels=args.levels,
                                      dither=args.dither, dither_strength=args.dither_strength)
        def ink(im, msk):
            if not args.outline:
                return im
            if args.outline_mode == "ink":
                return add_outline(im, msk, color=oc)     # no-op when scipy is absent
            return outline_own(im, msk, args.levels, args.outline_steps)

        # The studio draws in dab blocks of fr["px"] screen pixels. To land on OUR lattice canvas we
        # vote the quantised frame down to a cell at least as big as a dab (cell_px), snap each cell to
        # one lattice colour, ink at cell scale, then nearest-upscale to the target. Both sides get the
        # same vote so the comparison is style only, not geometry.
        px = int(fr.get("px") or 1)
        cell_px = max(args.cell, px)
        k1 = max(1, cell_px // px)                     # screen px -> lattice cell
        cvh, cvw = h // k1, w // k1                     # the lattice canvas
        k2 = max(1, int(round(args.target / max(cvw, 1))))   # lattice canvas -> screen, nearest only
        raw_out = look_out = None
        if k1 > 1 or args.cell > 1:
            hh, ww = cvh * k1, cvw * k1
            cut = step2[:hh, :ww, :]
            cm = mask[:hh, :ww]
            cell = cut.reshape(cvh, k1, cvw, k1, 3).mean(axis=(1, 3))
            cell = np.round(cell * (args.levels - 1)) / (args.levels - 1)
            cmask = (cm.reshape(cvh, k1, cvw, k1).mean(axis=(1, 3)) > 0.5).astype(np.float32)
            look_out = np.repeat(np.repeat(ink(cell, cmask), k2, 0), k2, 1)
            # raw stays at its native size: we do not invent studio pixels it never drew
            raw_out = a[:hh, :ww, :]
        else:
            look_out = ink(step2, mask)
            raw_out = a

        lab = fr["label"]
        save_png(os.path.join(outdir, "raw", lab + ".png"), raw_out)
        save_png(os.path.join(outdir, "look", lab + ".png"), look_out)
        before, after = metrics(a), metrics(look_out)
        row = {"label": lab, "t": fr.get("t"), "subject_coverage": round(float(mask.mean()), 4),
               "n_lattice_colours": int(len(pal)), "before": before, "after": after}
        audit["frames"].append(row)

        strips_raw.append(Image.open(os.path.join(outdir, "raw", lab + ".png")))
        strips_look.append(Image.open(os.path.join(outdir, "look", lab + ".png")))
        zw, zh = strips_raw[-1].size
        cx, cy = zw // 2, zh // 2
        c = args.zoom
        box = (max(0, cx - 100), max(0, cy - 70), min(zw, cx + 100), min(zh, cy + 70))
        zoom_raw.append(strips_raw[-1].crop(box).resize(((box[2]-box[0])*c, (box[3]-box[1])*c), Image.NEAREST))
        zoom_look.append(strips_look[-1].crop(box).resize(((box[2]-box[0])*c, (box[3]-box[1])*c), Image.NEAREST))

    def strip(imgs, path):
        W = sum(i.size[0] for i in imgs)
        H = max(i.size[1] for i in imgs)
        sheet = Image.new("RGB", (W, H), (8, 10, 16))
        x = 0
        for i in imgs:
            sheet.paste(i, (x, 0))
            x += i.size[0]
        sheet.save(path)
        return path

    strip(strips_raw, os.path.join(outdir, "contact-raw.png"))
    strip(strips_look, os.path.join(outdir, "contact-look.png"))
    both = Image.new("RGB", (max(strips_raw[0].size[0], strips_look[0].size[0]) * 2 + 8,
                             (strips_raw[0].size[1] + strips_look[0].size[1]) * 2 + 16), (8, 10, 16))
    both.paste(strips_raw[0], (0, 0))
    both.paste(strips_look[0], (0, strips_raw[0].size[1] + 8))
    both.save(os.path.join(outdir, "contact.png"))
    strip(zoom_raw, os.path.join(outdir, "zoom-raw.png"))
    strip(zoom_look, os.path.join(outdir, "zoom-look.png"))
    zsheet = Image.new("RGB", (zoom_raw[0].size[0] * 2 + 8, max(zoom_raw[0].size[1], zoom_look[0].size[1]) * 2 + 16), (8, 10, 16))
    zsheet.paste(zoom_raw[0], (0, 0))
    zsheet.paste(zoom_look[0], (0, zoom_raw[0].size[1] + 8))
    zsheet.save(os.path.join(outdir, "zoom.png"))

    with open(os.path.join(outdir, "audit.json"), "w") as f:
        json.dump(audit, f, indent=1)

    def fmt(m):
        return (f"cov {m.get('coverage', 0):.3f}  lum {m.get('subject_lum', 0):.3f}  "
                f"colours {m.get('distinct', 0):>3}  on-lattice {m.get('on_lattice', 0):.3f}  "
                f"dither {m.get('dither', 0):.2f}  outline {m.get('outline', 0):.3f}  block {m.get('block', 0)}")
    print(f"== {label} ({d.get('name')})  filters: bands={args.bands} lattice={args.levels} "
          f"dither={args.dither}@{args.dither_strength} outline={args.outline} target={args.target}")
    for row in audit["frames"]:
        print(f"  {row['label']:<10} subj {row['subject_coverage']:.3f}  {row['n_lattice_colours']:>2} pal  "
              f"BEFORE {fmt(row['before'])}")
        print(f"  {'':<10} {'':<11}          AFTER  {fmt(row['after'])}")
    print("wrote", outdir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
