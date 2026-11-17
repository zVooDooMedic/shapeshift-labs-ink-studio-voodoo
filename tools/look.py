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
from render_pixel import srgb_to_oklab, oklab_to_srgb  # noqa: E402


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


def hex_rgb(h):
    h = str(h).lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


def oklab_polar(lab):
    """OKLab -> (lightness, hue degrees, chroma). Hue is the material axis."""
    l, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    return l, np.degrees(np.arctan2(b, a)), np.hypot(a, b)


def hue_gap(x, y):
    """Short-way-round circular distance in degrees."""
    d = np.abs((x - y + 180.0) % 360.0 - 180.0)
    return d


def build_ramp_ladders(pal, ramps, levels, hue_pad=14.0, chroma_pad=0.035, min_rungs=2):
    """Turn the diorama's own material ramps into lattice ladders.

    The reference law has two halves that must both hold: one colour ramp per material (no colour
    crosses materials) AND every pixel on the same per-channel lattice. The way to satisfy both is
    to let the ramp own the HUE COLUMN and let the lattice own the RUNGS:

      * each ramp becomes a hue/chroma band, measured from the colours the studio actually shaded on
      * the candidates for that ramp are lattice colours inside that band, sorted by lightness
      * a cell snaps to the nearest candidate of the ramp it belongs to

    So the palette stays small and structural, and the frame stays exactly on-lattice.
    """
    pal_rgb = np.stack([hex_rgb(c) for c in pal]) if pal else np.zeros((0, 3), np.float32)
    if len(pal_rgb) == 0 or not ramps:
        return []
    pal_lab = srgb_to_oklab(pal_rgb)
    _, pal_hue, pal_chroma = oklab_polar(pal_lab)

    v = np.arange(levels) / (levels - 1)
    grid = np.stack(np.meshgrid(v, v, v, indexing="ij"), -1).reshape(-1, 3).astype(np.float32)
    lab_grid = srgb_to_oklab(grid)
    _, g_hue, g_chroma = oklab_polar(lab_grid)

    ladders = []
    for rid, r in enumerate(ramps):
        idx = [i for i in r.get("idx", []) if 0 <= i < len(pal_rgb)]
        if not idx:
            continue
        hs, cs = pal_hue[idx], pal_chroma[idx]
        w = np.maximum(cs, 1e-3)
        hue_c = np.degrees(np.arctan2((np.sin(np.radians(hs)) * w).sum(), (np.cos(np.radians(hs)) * w).sum())) % 360.0
        chroma_hi = float(cs.max()) * 1.35 + chroma_pad
        chroma_lo = max(0.0, float(cs.max()) * 0.18)

        band = (hue_gap(g_hue, hue_c) <= hue_pad) & (g_chroma >= chroma_lo) & (g_chroma <= chroma_hi)
        if band.sum() < min_rungs:                       # narrow band: widen hue until it has rungs
            for pad in (24.0, 36.0, 50.0, 70.0):
                band = (hue_gap(g_hue, hue_c) <= pad) & (g_chroma >= chroma_lo) & (g_chroma <= chroma_hi)
                if band.sum() >= min_rungs:
                    hue_pad_used = pad
                    break
        if band.sum() < min_rungs:
            continue
        cols = grid[band]
        order = np.argsort(lab_grid[band][:, 0])          # dark -> light
        ladders.append({
            "ramp": rid,
            "hue": float(hue_c),
            "chroma": float(cs.max()),
            "dabs": int(r.get("dabs") or 0),
            "pal": [pal[i] for i in idx],
            "cols": cols[order],
            "lab": lab_grid[band][order],
        })
    return ladders


def ramp_snap(img, mask, ladders, neutral=0.022, levels=16):
    """Snap each cell to the nearest colour INSIDE its own material ramp.

    Returns (out, stats). Non-neutral cells are assigned to the ramp whose hue column they sit
    nearest; neutral cells (near-zero chroma: greys, whites, blacks) belong to no material and take
    the plain lattice. `cross_before` counts how many cells a global snap would have thrown into a
    different material's column — that is the failure this stage removes.
    """
    out = np.round(img * (levels - 1)) / (levels - 1)   # lattice everywhere first, background included
    ladders = [d for d in ladders if len(d.get("cols", []))]
    if not ladders:
        return out, {"ramps_used": 0, "cells": 0, "snapped": 0, "neutral": 0, "cross_before": 0.0}

    hues = np.array([d["hue"] for d in ladders], dtype=np.float32)
    chro = np.array([d["chroma"] for d in ladders], dtype=np.float32)

    h, w, _ = img.shape
    sel = mask > 0.5
    cell = out[sel]
    if len(cell) == 0:
        return out, {"ramps_used": len(ladders), "cells": 0, "snapped": 0, "neutral": 0, "cross_before": 0.0}
    lab = srgb_to_oklab(cell.astype(np.float32))
    _, hue, chroma = oklab_polar(lab)

    is_neutral = chroma < neutral
    # nearest column, circular in hue, tie-broken by how close the chroma is to that material
    hd = np.abs((hue[:, None] - hues[None, :] + 180.0) % 360.0 - 180.0)
    pick = np.argmin(hd + 12.0 * np.abs(chroma[:, None] - chro[None, :]), axis=1)

    # snap per ramp, so the distance matrix is (cells in that ramp) x (that ramp's rungs) only
    snapped = lab.copy()
    for r_i, lad in enumerate(ladders):
        m = (pick == r_i) & ~is_neutral
        if not m.any():
            continue
        sub = lab[m]
        d2 = ((sub[:, None, :] - lad["lab"][None, :, :]) ** 2).sum(axis=2)
        snapped[m] = lad["lab"][np.argmin(d2, axis=1)]

    plain = cell                                        # already lattice-rounded
    _, p_hue, _ = oklab_polar(srgb_to_oklab(plain.astype(np.float32)))
    cross = (~is_neutral) & (hue_gap(p_hue, hues[pick]) > 20.0)

    rgb_out = np.clip(oklab_to_srgb(snapped.astype(np.float64)), 0, 1)
    rgb_out = np.round(rgb_out * (levels - 1)) / (levels - 1)      # keep the channels exactly on-lattice
    out[sel] = rgb_out

    stats = {
        "ramps_used": len(ladders),
        "cells": int(sel.sum()),
        "snapped": int((~is_neutral).sum()),
        "neutral": int(is_neutral.sum()),
        "cross_before": round(float(cross.sum()) / max(1, (~is_neutral).sum()), 4),
    }
    return out, stats


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
    ap.add_argument("--palette-mode", default="ramp", choices=["ramp", "global"],
                    help="ramp = snap every cell inside its own material ramp (the reference law);\n"
                         "global = one lattice for the whole frame, no material identity")
    ap.add_argument("--ramp-neutral", type=float, default=0.022,
                    help="OKLab chroma under which a cell is a neutral (grey/white/black) and takes\n"
                         "the plain lattice instead of a material ramp")
    ap.add_argument("--ramp-hue-pad", type=float, default=14.0,
                    help="degrees of hue a material ramp may occupy before it stops being one ramp")
    args = ap.parse_args()

    d = json.load(open(args.frames))
    label = args.label or d.get("id") or "scene"
    outdir = os.path.abspath(args.out_dir or os.path.join(ROOT, "studio/out/look", label))
    for sub in ("raw", "look"):
        os.makedirs(os.path.join(outdir, sub), exist_ok=True)

    oc = tuple(int(v) / 255 for v in args.outline_color.split(","))
    ladders = []
    if args.palette_mode == "ramp":
        ladders = build_ramp_ladders(d.get("pal") or [], d.get("ramps") or [], args.levels,
                                     hue_pad=args.ramp_hue_pad)
        if not ladders:
            print("!! --palette-mode ramp but the dump carries no ramps/palette "
                  "(re-run tools/frames-dump.js); falling back to one global lattice", file=sys.stderr)
    audit = {"scene": label, "name": d.get("name"), "filters": {
        "levels": args.levels, "bands": args.bands, "contrast": args.contrast,
        "dither": args.dither, "dither_strength": args.dither_strength,
        "outline": args.outline, "outline_color": args.outline_color, "target": args.target,
        "outline_mode": args.outline_mode, "outline_steps": args.outline_steps,
        "palette_mode": args.palette_mode, "ramp_neutral": args.ramp_neutral,
        "ramp_hue_pad": args.ramp_hue_pad, "ramp_ladders": len(ladders),
        "cell": args.cell},
        "frames": []}
    strips_raw, strips_look, zoom_raw, zoom_look = [], [], [], []

    for fr in d["frames"]:
        ramp_stats = {"ramps_used": 0, "cells": 0, "snapped": 0, "neutral": 0, "cross_before": 0.0}
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
            cmask = (cm.reshape(cvh, k1, cvw, k1).mean(axis=(1, 3)) > 0.5).astype(np.float32)
            if ladders:
                cell, ramp_stats = ramp_snap(cell, cmask, ladders,
                                             neutral=args.ramp_neutral, levels=args.levels)
            else:
                cell = np.round(cell * (args.levels - 1)) / (args.levels - 1)
            look_out = np.repeat(np.repeat(ink(cell, cmask), k2, 0), k2, 1)
            # raw stays at its native size: we do not invent studio pixels it never drew
            raw_out = a[:hh, :ww, :]
        else:
            if ladders:
                step2, ramp_stats = ramp_snap(step2, mask, ladders,
                                              neutral=args.ramp_neutral, levels=args.levels)
            look_out = ink(step2, mask)
            raw_out = a

        lab = fr["label"]
        save_png(os.path.join(outdir, "raw", lab + ".png"), raw_out)
        save_png(os.path.join(outdir, "look", lab + ".png"), look_out)
        before, after = metrics(a), metrics(look_out)
        row = {"label": lab, "t": fr.get("t"), "subject_coverage": round(float(mask.mean()), 4),
               "n_lattice_colours": int(len(pal)), "before": before, "after": after,
               "ramp": ramp_stats}
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
        r = row.get("ramp") or {}
        if r.get("cells"):
            print(f"  {'':<10} {'':<11}          RAMPS  {r['ramps_used']} ladders  {r['snapped']} cells on a "
                  f"material ramp  {r['neutral']} neutral  "
                  f"global-snap cross-material {100 * r.get('cross_before', 0):.1f}% avoided")
    print("wrote", outdir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
