#!/usr/bin/env python3
"""ink-studio scene -> standard 3DGS .ply, readable by any splat tool.

ink-studio stores 16 floats per splat (src/builder.js:194-200):

    [x, y, z, density]
    [c00, c01, c02, packedRGB]           packedRGB = R + G*256 + B*65536
    [c11, c12, c22, kind]
    [phase, speed, range, extra]

so c00 c01 c02 / c01 c11 c12 / c02 c12 c22 is an explicit symmetric 3x3 covariance —
a flat dab laid on the surface, its smallest eigenvalue along the surface normal.
3DGS .ply wants scale + rotation instead, which is exactly the eigen-decomposition
of that covariance: scale_i = sqrt(lambda_i), rotation = the eigenvector frame with
the THIN axis (the normal) on local +Z. That last part is not cosmetic: a rasteriser
that culls backfaces reads the normal off local +Z, and a frame in the wrong order
silently renders 8% of the skin.

Storage matches our SDF pipeline's write_ply (log scale, logit opacity, SH DC band).

usage:
    python3 tools/ink_to_ply.py <scene.js> <out.ply> [--scale K] [--no-flip]
    python3 tools/ink_to_ply.py demos/labscenes.js out/cabinet.ply

--scale multiplies every sigma. ink-studio sizes splats for ITS screen density
(`detail`, art pixels x screen pixels); if you rasterise at a different art
resolution, raise --scale until the coverage matches (1.0 is already right for
our 427x240 lane, verified against ink-studio's own renderer).

--no-flip keeps ink-studio's Y-up authoring frame. The default flips to the
Y-down / Z-forward frame 3DGS tools assume, which is what our CPU rasteriser
(sdf-splat-pixel/splat_cpu.py) and most viewers expect.
"""
import argparse, json, os, subprocess, sys

PIPELINE = os.environ.get("SDF_SPLAT_PIXEL", os.path.expanduser("~/SafeHouse/Games/sdf-splat-pixel"))
sys.path.insert(0, PIPELINE)
import numpy as np                                   # noqa: E402
import sdf_splat as SD                               # noqa: E402  (reuse its quaternion algebra)

SH_C0 = 0.28209479177387814
REPO = os.environ.get("INK_STUDIO", os.path.expanduser("~/SafeHouse/Games/ink-studio"))

def scene_rows(scene, repo=REPO):
    """Build the scene with ink-studio itself and hand the raw splat buffer back."""
    scene = os.path.abspath(os.path.expanduser(scene))
    r = subprocess.run(["node", os.path.join(repo, "tools", "_dump-scene.js"), scene],
                       capture_output=True, text=True)
    if not r.stdout.strip():
        raise RuntimeError("scene build failed: " + (r.stderr or "")[:900])
    return json.loads(r.stdout)


def to_splats(d, flip=True, scale_mul=1.0):
    A = np.array(d["rows"], np.float64)
    # Drop dead splats BEFORE anything else. ink-studio parks unused dabs (the
    # dust/streak slots) at a far Y with density 0. The old clamp below turned
    # those into 5%-opacity points 50 units away, which stretched the subject
    # bounds and made every auto-fit frame useless.
    alive = A[:, 3] > 1e-4
    dropped = int((~alive).sum())
    if dropped:
        A = A[alive]
        print("  dropped %d dead splats (density 0, parked far)" % dropped)
    # Drop geometric outliers. The rig parks a few guide splats on a debug axis
    # (this scene: 22 points at x=z=0 running y=3..50). They are opaque, so the
    # density filter above does not catch them, and a single one 48 units away
    # stretches the subject bounds so every auto-fit framing is ruined.
    # Robust rule: anything beyond 3x the 95th-percentile radius is not the subject.
    med = np.median(A[:, 0:3], axis=0)
    rad = np.linalg.norm(A[:, 0:3] - med, axis=1)
    lim = max(float(np.percentile(rad, 95)) * 3.0, 1e-6)
    far = rad > lim
    nfar = int(far.sum())
    if nfar:
        A = A[~far]
        print("  dropped %d outlier splats beyond %.2f units of the subject centre" % (nfar, lim))
    P = A[:, 0:3].copy()
    C = np.stack([np.stack([A[:, 4], A[:, 5], A[:, 6]], -1),
                  np.stack([A[:, 5], A[:, 8], A[:, 9]], -1),
                  np.stack([A[:, 6], A[:, 9], A[:, 10]], -1)], 1)
    packed = A[:, 7]
    rgb = np.stack([packed % 256, (packed // 256) % 256, (packed // 65536) % 256], 1) / 255.0
    dens = A[:, 3]

    lam, evec = np.linalg.eigh(C)             # numpy returns ASCENDING eigenvalues
    nrm = evec[:, :, 0]                       # thinnest axis = the surface normal
    fat = evec[:, :, 2]                       # fattest axis, laid on local +X
    if flip:
        P[:, 1] *= -1.0
        nrm = nrm * np.array([1.0, -1.0, 1.0])
        fat = fat * np.array([1.0, -1.0, 1.0])
    q_flip = (SD.quat_from_to(np.tile([0.0, 1.0, 0.0], (P.shape[0], 1)),
                              np.tile([0.0, -1.0, 0.0], (P.shape[0], 1))) if flip else
               np.tile([1.0, 0.0, 0.0, 0.0], (P.shape[0], 1)))
    q1 = SD.quat_from_to(np.tile([0.0, 0.0, 1.0], (P.shape[0], 1)), nrm)
    tgt = fat - nrm * np.einsum("ni,ni->n", fat, nrm)[:, None]
    ang = np.arctan2(np.einsum("ni,ni->n", np.cross(nrm, tgt), np.cross(nrm, fat)),
                     np.einsum("ni,ni->n", tgt, fat))
    q = SD.quat_mul(SD.quat_mul(q1, SD.quat_about_z(ang)), q_flip)
    scales = np.sqrt(np.maximum(np.stack([lam[:, 2], lam[:, 1], lam[:, 0]], 1), 1e-12)) * scale_mul
    return {"positions": P.astype(np.float32), "scales": scales.astype(np.float32),
            "rotations": q.astype(np.float32),
            "opacities": np.clip(dens, 0.05, 0.999).astype(np.float32),
            "colors": rgb.astype(np.float32), "normals": nrm.astype(np.float32)}


def write_ply(path, s, sh_degree=0):
    n = s["positions"].shape[0]
    n_rest = {0: 0, 1: 9, 2: 24, 3: 45}[sh_degree]
    names = (["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2"]
             + ["f_rest_%d" % k for k in range(n_rest)]
             + ["opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"])
    arr = np.zeros(n, dtype=[(k, "<f4") for k in names])   # f_rest stays 0: base colour only
    pos, scl, rot, op, col, nrm = (s["positions"], s["scales"], s["rotations"],
                                   s["opacities"], s["colors"], s["normals"])
    arr["x"], arr["y"], arr["z"] = pos[:, 0], pos[:, 1], pos[:, 2]
    arr["nx"], arr["ny"], arr["nz"] = nrm[:, 0], nrm[:, 1], nrm[:, 2]
    fdc = (col - 0.5) / SH_C0
    arr["f_dc_0"], arr["f_dc_1"], arr["f_dc_2"] = fdc[:, 0], fdc[:, 1], fdc[:, 2]
    op = np.clip(op, 1e-6, 1 - 1e-6)
    arr["opacity"] = np.log(op / (1 - op))
    for i in range(3):
        arr[f"scale_{i}"] = np.log(np.maximum(scl[:, i], 1e-8))
    for i in range(4):
        arr[f"rot_{i}"] = rot[:, i]
    hdr = ("ply\nformat binary_little_endian 1.0\ncomment written by ink-studio/tools/ink_to_ply.py\n"
           f"element vertex {n}\n" + "\n".join(f"property float {k}" for k in names) + "\nend_header\n")
    with open(path, "wb") as fh:
        fh.write(hdr.encode("ascii"))
        fh.write(arr.tobytes())
    return n


def densify(s, k, reach=1.6):
    """Subdivide every dab into k*k sub-dabs laid on its own tangent plane.

    Why: ink-studio sizes its dabs for a FIXED camera. That is correct for a 2D
    look and wrong for a free camera — a 2-unit figure carries ~1.4k dabs, the
    proven SDF sampler carries ~116k for the same subject, and the 85x gap only
    shows up once you orbit (holes read as missing anatomy). Subdividing keeps
    the authored form, palette and normals exactly as they are and only raises
    point density, which is the actual variable.

    Each sub-dab: same orientation, same colour, same opacity; position jittered
    inside an ellipse of radius `reach` sigma on the dab's own plane; size scaled
    by 1/k so neighbours overlap by about one sigma.
    """
    if k <= 1:
        return s
    P, S, R = s["positions"], s["scales"], s["rotations"]
    # quaternion -> rotation matrix (columns are the dab's local x, y, z axes)
    w, x, y, z = R[:, 0], R[:, 1], R[:, 2], R[:, 3]
    ax = np.stack([1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)], 1)
    ay = np.stack([2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)], 1)
    grid = (np.arange(k) + 0.5) / k * 2.0 - 1.0
    gx, gy = (a.ravel() for a in np.meshgrid(grid, grid))
    keep = (gx * gx + gy * gy) <= 1.0 + (1.0 / k)      # ellipse mask, edge-safe
    gx, gy = gx[keep], gy[keep]
    m = gx.size
    off = (gx[None, :, None] * S[:, 0, None, None] * reach * ax[:, None, :]
           + gy[None, :, None] * S[:, 1, None, None] * reach * ay[:, None, :])
    n = P.shape[0]
    out = {
        "positions": (P[:, None, :] + off).reshape(n * m, 3).astype(np.float32),
        "scales": np.repeat(np.stack([S[:, 0] * (reach / k),
                                      S[:, 1] * (reach / k),
                                      S[:, 2]], 1), m, axis=0).astype(np.float32),
        "rotations": np.repeat(R, m, axis=0).astype(np.float32),
        # keep total coverage: m smaller dabs must not fade the surface out
        "opacities": np.repeat(np.clip(s["opacities"] * (1.0 + 0.05 * k), 0.05, 0.999), m, axis=0).astype(np.float32),
        "colors": np.repeat(s["colors"], m, axis=0).astype(np.float32),
        "normals": np.repeat(s["normals"], m, axis=0).astype(np.float32),
    }
    print("  densified x%d: %d -> %d splats (%.1f per dab)" % (k, n, n * m, m))
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("scene")
    ap.add_argument("out")
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--densify", type=int, default=1,
                    help="subdivide each dab into k*k sub-dabs (1 = off; 8-16 for free-camera 3D)")
    ap.add_argument("--no-flip", action="store_true")
    a = ap.parse_args()
    if a.scene.endswith(".json"):
        with open(a.scene) as fh:
            d = json.load(fh)          # pre-posed frame buffer from _dump-frames-ply.js
    else:
        d = scene_rows(a.scene)
    s = to_splats(d, flip=not a.no_flip, scale_mul=a.scale)
    s = densify(s, a.densify)
    n = write_ply(a.out, s)
    P, S = s["positions"], s["scales"]
    print(f"{os.path.basename(a.scene)} -> {a.out}: {n} splats, {os.path.getsize(a.out)} bytes")
    print(f"  extent   x {P[:,0].min():.2f}..{P[:,0].max():.2f}  y {P[:,1].min():.2f}..{P[:,1].max():.2f}  z {P[:,2].min():.2f}..{P[:,2].max():.2f}")
    print(f"  sigma    p50 {np.percentile(S[:,0],50):.4f} / p95 {np.percentile(S[:,0],95):.4f} (fat axis), "
          f"p50 {np.percentile(S[:,2],50):.4f} (normal axis)   scale x{a.scale}")
    print(f"  colours  {len({tuple(map(int, v*255)) for v in s['colors']})} distinct, "
          f"camera was {d.get('cam', {}).get('dist')} away, detail {d.get('detail')}")
