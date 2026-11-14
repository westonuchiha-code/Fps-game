#!/usr/bin/env python3
"""Mix microscope: per-part loudness over time for one loop track.

    python3 tools/music/analyze.py menu          # menu | m01 | drive | boss
    python3 tools/music/analyze.py m01 --per 8   # 8-bar columns

Prints, for every part, its short-term loudness (LUFS, after auto-balance,
before mastering) in each N-bar section, so the dynamic arc and the balance of
an arrangement can be read without listening.  Also prints the pre-master
spectrum per section.  A development aid; not part of the build.
"""
from __future__ import annotations

import argparse
import importlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from emg import SR, dsp, fx, mix  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("track")
    ap.add_argument("--per", type=int, default=4)
    ap.add_argument("--tmp", default="/tmp/emg-music")
    args = ap.parse_args()
    song = importlib.import_module(f"tracks.{args.track}").build()
    audio, start, length = mix.render_parts(song, os.path.join(args.tmp, args.track))
    n = length
    bars = song.bars
    cols = list(range(0, bars, args.per))
    print(f"{song.name}: loudness per {args.per} bars (LUFS, pre-master scale)")
    print(" " * 14 + "".join(f"{c + 1:>6d}" for c in cols) + "   whole  crest")
    total = {}
    for part in song.parts:
        x = audio.get(part.name)
        if x is None:
            continue
        seg = x[start:start + length]
        if part.hp:
            seg = dsp.periodic(lambda s: dsp.highpass(s, part.hp, 2), seg)
        if part.lp:
            seg = dsp.periodic(lambda s: dsp.lowpass(s, part.lp, 2), seg)
        if part.cho:
            seg = fx.chorus(seg, part.cho / 127.0, periodic=True)
        loud = dsp.lufs(seg, periodic=True)
        y = seg * dsp.lin(part.level + part.gain - loud)
        total[part.stem] = y if part.stem not in total else total[part.stem] + y
        vals = []
        for c in cols:
            a = int(n * c / bars)
            b = int(n * min(bars, c + args.per) / bars)
            l = dsp.lufs(y[a:b])
            vals.append("     ." if l < -60 else f"{l:6.1f}")
        crest = dsp.sample_peak_db(y) - (part.level + part.gain)
        print(f"{part.name:<14s}" + "".join(vals) + f"  {part.level + part.gain:6.1f} {crest:6.1f}")
    for stem, y in total.items():
        vals = []
        for c in cols:
            a = int(n * c / bars)
            b = int(n * min(bars, c + args.per) / bars)
            vals.append(f"{dsp.lufs(y[a:b]):6.1f}")
        print(f"{'[' + stem + ' dry]':<14s}" + "".join(vals) + f"  {dsp.lufs(y, periodic=True):6.1f} "
              f"{dsp.sample_peak_db(y) - dsp.lufs(y, periodic=True):6.1f}")
        b = dsp.spectrum_bands(y)
        print("   spectrum: " + "  ".join(f"{k} {v:.1f}" for k, v in b.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
