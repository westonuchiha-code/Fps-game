#!/usr/bin/env python3
"""Acceptance checks for the generated voice files (nothing here needs ears).

    python3 tools/voice/verify.py            # exit code 0 = all checks pass
    python3 tools/voice/verify.py --ffmpeg   # also cross-check loudness with ffmpeg's ebur128
    python3 tools/voice/verify.py --all      # print one row per file

For every id that src/data/dialogue.json implies it checks that
public/audio/vo/<id>.ogg

  * exists, is OGG Vorbis, mono, 44.1 kHz;
  * lasts between 0.25 s and 14 s;
  * measures -16 LUFS +-1.5 LU integrated (BS.1770; clips shorter than one
    400 ms gating block use the ungated K-weighted fallback, marked '*');
  * has a true peak <= -1.5 dBTP;
  * has no DC offset, starts and ends at (near) zero, and has roughly 30 ms of
    silence before the first and after the last sound;
  * agrees with src/data/vo-manifest.json (duration to the millisecond, speaker).

and prints loudness statistics per speaker.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

import gen_voice as G  # noqa: E402
from vo_dsp import find_active  # noqa: E402
from vo_measure import SR, loudness, true_peak_db  # noqa: E402

DUR_MIN, DUR_MAX = 0.25, 14.0
LUFS_TOL = 1.5
DC_MAX = 1e-3                # |mean| in full-scale units (-60 dBFS)
EDGE_MAX_DB = -50.0          # peak of the first / last millisecond
PAD_RANGE_MS = (22.0, 45.0)  # accepted silence before the first / after the last sound (target 30)


def ffmpeg_ebur128(path: str):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    i = re.findall(r"I:\s+(-?[\d.]+) LUFS", r)
    p = re.findall(r"Peak:\s+(-?[\d.]+) dBFS", r)
    return (float(i[-1]) if i else None, float(p[-1]) if p else None)


def check_file(path: str) -> dict:
    info = sf.info(path)
    x, sr = sf.read(path, dtype="float64")
    res = {"format": f"{info.format}/{info.subtype}", "sr": sr, "channels": info.channels, "dur": len(x) / sr}
    if x.ndim > 1:
        x = x.mean(axis=1)
    m = loudness(x, sr)
    res.update(lufs=m["lufs"], method=m["method"], tp=true_peak_db(x, sr), dc=float(np.mean(x)))
    n1 = max(1, int(0.001 * sr))
    res["first_db"] = 20 * np.log10(max(float(np.max(np.abs(x[:n1]))), 1e-9))
    res["last_db"] = 20 * np.log10(max(float(np.max(np.abs(x[-n1:]))), 1e-9))
    act = find_active(x, sr, thresh_db=G.EDGE_FLOOR_DB, rel=False)
    if act is None:
        res["lead_ms"] = res["trail_ms"] = float("nan")
    else:
        res["lead_ms"] = 1000.0 * act[0] / sr
        res["trail_ms"] = 1000.0 * (len(x) - act[1]) / sr
    return res


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ffmpeg", action="store_true", help="cross-check loudness / peak with ffmpeg ebur128")
    ap.add_argument("--all", action="store_true", help="print a row for every file")
    args = ap.parse_args(argv)

    entries = G.load_entries()
    manifest = {}
    problems: list[str] = []
    if os.path.exists(G.MANIFEST):
        with open(G.MANIFEST, encoding="utf-8") as fh:
            manifest = json.load(fh)
    else:
        problems.append("manifest missing: " + os.path.relpath(G.MANIFEST, G.REPO))

    rows = []
    total_bytes = 0
    for e in entries:
        path = os.path.join(G.OUT_DIR, e["id"] + ".ogg")
        if not os.path.exists(path):
            problems.append(f"{e['id']}: file missing")
            continue
        total_bytes += os.path.getsize(path)
        try:
            r = check_file(path)
        except Exception as exc:
            problems.append(f"{e['id']}: unreadable ({exc})")
            continue
        r.update(id=e["id"], who=e["who"], bytes=os.path.getsize(path))
        rows.append(r)
        bad = []
        if r["format"] != "OGG/VORBIS":
            bad.append(f"format {r['format']}")
        if r["sr"] != SR or r["channels"] != 1:
            bad.append(f"{r['channels']} ch @ {r['sr']} Hz")
        if not (DUR_MIN <= r["dur"] <= DUR_MAX):
            bad.append(f"duration {r['dur']:.3f}s outside {DUR_MIN}-{DUR_MAX}s")
        if abs(r["lufs"] - G.TARGET_LUFS) > LUFS_TOL:
            bad.append(f"loudness {r['lufs']:.2f} LUFS")
        if r["tp"] > G.PEAK_LIMIT_DB + 0.005:
            bad.append(f"true peak {r['tp']:.2f} dBTP")
        if abs(r["dc"]) > DC_MAX:
            bad.append(f"DC offset {r['dc']:+.5f}")
        if r["first_db"] > EDGE_MAX_DB or r["last_db"] > EDGE_MAX_DB:
            bad.append(f"edge not silent (first ms {r['first_db']:.0f} dB, last ms {r['last_db']:.0f} dB)")
        for name in ("lead_ms", "trail_ms"):
            if not (PAD_RANGE_MS[0] <= r[name] <= PAD_RANGE_MS[1]):
                bad.append(f"{name.split('_')[0]} silence {r[name]:.0f} ms")
        man = manifest.get(e["id"])
        if man is None:
            bad.append("not in manifest")
        else:
            if abs(man.get("dur", -1) - r["dur"]) > 0.0015:
                bad.append(f"manifest dur {man.get('dur')} != {r['dur']:.3f}")
            if man.get("who") != e["who"]:
                bad.append(f"manifest who {man.get('who')!r} != {e['who']!r}")
        if args.ffmpeg and r["method"] == "r128":
            fi, fp = ffmpeg_ebur128(path)
            r["ff_lufs"], r["ff_tp"] = fi, fp
            # under ~1.5 s the two implementations place the few gating blocks differently
            tol = 0.25 if r["dur"] >= 1.5 else 0.8
            if fi is not None and fi > -69.0 and abs(fi - r["lufs"]) > tol:
                bad.append(f"ffmpeg ebur128 says {fi} LUFS, ours {r['lufs']:.2f}")
        if bad:
            problems.append(f"{e['id']}: " + "; ".join(bad))

    ids = {e["id"] for e in entries}
    for extra in sorted(set(manifest) - ids):
        problems.append(f"manifest has unknown id {extra!r}")
    if os.path.isdir(G.OUT_DIR):
        for f in sorted(os.listdir(G.OUT_DIR)):
            if f.endswith(".ogg") and f[:-4] not in ids:
                problems.append(f"stale file {f} (no such id)")

    if args.all:
        print(f"{'id':22s} {'who':8s} {'dur':>6s} {'LUFS':>7s} {'dBTP':>6s} {'lead':>5s} {'trail':>5s} {'kB':>6s}")
        for r in rows:
            print(f"{r['id']:22s} {r['who']:8s} {r['dur']:6.2f} {r['lufs']:7.2f}{'*' if r['method'] != 'r128' else ' '}"
                  f"{r['tp']:6.2f} {r['lead_ms']:5.0f} {r['trail_ms']:5.0f} {r['bytes'] / 1024:6.1f}")
        print()

    print(f"{'speaker':9s} {'files':>5s} {'seconds':>8s} {'LUFS mean':>10s} {'min':>7s} {'max':>7s} {'sd':>5s} "
          f"{'max dBTP':>9s} {'dur min':>8s} {'dur max':>8s} {'kB':>7s}")
    order = list(dict.fromkeys(e["who"] for e in entries))
    for who in order + ["ALL"]:
        rs = [r for r in rows if who == "ALL" or r["who"] == who]
        if not rs:
            continue
        l = np.array([r["lufs"] for r in rs])
        d = np.array([r["dur"] for r in rs])
        print(f"{who:9s} {len(rs):5d} {d.sum():8.1f} {l.mean():10.2f} {l.min():7.2f} {l.max():7.2f} {l.std():5.2f} "
              f"{max(r['tp'] for r in rs):9.2f} {d.min():8.2f} {d.max():8.2f} {sum(r['bytes'] for r in rs) / 1024:7.0f}")
    fb = [r["id"] for r in rows if r["method"] != "r128"]
    print(f"\nexpected ids: {len(entries)}   files checked: {len(rows)}   total size: {total_bytes / 1e6:.2f} MB")
    print(f"loudness target {G.TARGET_LUFS} LUFS +-{LUFS_TOL} LU, true-peak limit {G.PEAK_LIMIT_DB} dBTP, "
          f"duration {DUR_MIN}-{DUR_MAX} s")
    if fb:
        print(f"ungated loudness fallback used for {len(fb)} short clip(s): {', '.join(fb)}")
    if args.ffmpeg:
        diffs = [abs(r["ff_lufs"] - r["lufs"]) for r in rows if r.get("ff_lufs") is not None]
        if diffs:
            print(f"ffmpeg ebur128 cross-check on {len(diffs)} files: max |difference| {max(diffs):.2f} LU")
    if problems:
        print(f"\nFAIL: {len(problems)} problem(s)")
        for p in problems:
            print("  " + p)
        return 1
    print("\nPASS: every expected id has a valid file")
    return 0


if __name__ == "__main__":
    sys.exit(main())
