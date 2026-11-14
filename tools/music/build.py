#!/usr/bin/env python3
"""Build every piece of music for EVERYTHING MUST GO.

    python3 tools/music/build.py                 # everything, then verify
    python3 tools/music/build.py --only m01      # one track (menu|m01|drive|boss|stingers|
                                                 #   start|complete|death|objective)
    python3 tools/music/build.py --lint          # also list every lint finding
    python3 tools/music/build.py --no-verify --no-cache --jobs 2 --tmp /tmp/emg-music

Pipeline (all of it scripted, nothing is hand-edited):

    tracks/*.py   note data in code            ->  one MIDI file per instrument
    FluidSynth    FluidR3_GM.sf2, dry, float   ->  one WAV stem per instrument
    emg.mix       auto-balance, reverb/chorus sends, loop cut, mastering
    ffmpeg        libvorbis -q:a 4             ->  public/audio/music/*.ogg
                                               ->  src/data/music-manifest.json

Intermediate MIDI/WAV files go to --tmp (default /tmp/emg-music), never into
the repository.  Requires: python3 (numpy, scipy, mido, soundfile),
fluidsynth, /usr/share/sounds/sf2/FluidR3_GM.sf2, ffmpeg.
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from emg import SR, dsp, lint as lint_mod, mix  # noqa: E402
from emg.mix import Master, log  # noqa: E402
from tracks import motif  # noqa: E402

OUT_DIR = os.path.join(ROOT, "public", "audio", "music")
MANIFEST = os.path.join(ROOT, "src", "data", "music-manifest.json")

TP_LIMIT = -1.0          # decoded true peak must stay at or below this (dBTP)
TP_AIM = -1.1            # what the encode loop aims for
SUM_PEAK_AIM = -0.7      # m01 base+combat, decoded, sample peak (limit is -0.5 dBFS)

# ---------------------------------------------------------------- registry

LOOPS = {
    "menu": dict(
        module="tracks.menu", stems={"main": "menu.ogg"},
        master=Master(target=-17.0, comp_ratio=1.4, comp_thresh_rel=-1.0),
    ),
    "m01": dict(
        module="tracks.m01", stems={"base": "m01_base.ogg", "combat": "m01_combat.ogg"},
        master=Master(target=-17.0, comp_ratio=1.0),      # base stem; no bus compression
        sum_target=-15.0,
    ),
    "drive": dict(
        module="tracks.drive", stems={"main": "drive.ogg"},
        master=Master(target=-15.0, comp_ratio=1.8, comp_thresh_rel=-2.0, clip_knee=1.5),
    ),
    "boss": dict(
        module="tracks.boss", stems={"main": "boss.ogg"},
        master=Master(target=-15.0, comp_ratio=1.8, comp_thresh_rel=-2.0, clip_knee=1.5),
    ),
}

# stinger name -> (file, exact length in seconds, fade-out seconds)
STINGERS = {
    "start": ("sting_start.ogg", 5.0, 0.5),
    "complete": ("sting_complete.ogg", 9.4, 0.8),
    "death": ("sting_death.ogg", 4.4, 0.5),
    "objective": ("sting_objective.ogg", 2.2, 0.35),
}
STING_MASTER = Master(target=-14.0, comp_ratio=1.5, comp_thresh_rel=-1.0, clip_knee=1.5,
                      side_hp=120.0)


# ----------------------------------------------------------------- helpers

def _fmt_rows(rows) -> None:
    log("    part          stem     level   rawLUFS    gain    peak  notes  rev cho space")
    for r in rows:
        log(f"    {r['name']:<13s} {r['stem']:<7s} {r['level']:6.1f}  {r['raw_lufs']:7.1f} "
            f"{r['gain']:7.1f} {r['peak']:7.1f}  {r['notes']:5d}  {r['rev']:3d} {r['cho']:3d} {r['space']}")


def _lint(song, verbose: bool) -> None:
    res = lint_mod.lint(song, signatures=motif.SIGNATURES)
    for line in lint_mod.report(song, res, verbose=verbose):
        log(line)


def _encode_with_peak_guard(make, tmp, out_path, name, start_ceiling):
    """Encode; if the decoded true peak exceeds the limit (lossy codecs
    overshoot a little), lower the limiter ceiling and master again."""
    ceiling = start_ceiling
    for attempt in range(6):
        y, stats = make(ceiling)
        dec, tp = mix.encode_checked(y, tmp, out_path, name)
        if tp <= TP_AIM + 0.05:
            return y, dec, stats, ceiling, tp
        ceiling -= (tp - TP_AIM) + 0.05
    return y, dec, stats, ceiling, tp


# ------------------------------------------------------------------- loops

def build_loop(name: str, cfg: dict, args) -> dict:
    t0 = time.time()
    song = importlib.import_module(cfg["module"]).build()
    tmp = os.path.join(args.tmp, name)
    n_out = song.loop_samples
    log(f"\n=== {name}: {song.key}, {song.bpm:g} BPM, {song.bars} bars, "
        f"{n_out} samples ({n_out / SR:.4f} s) ===")
    _lint(song, args.lint)
    audio, start, length = mix.render_parts(song, tmp, jobs=args.jobs, cache=not args.no_cache)
    ident = mix.pass_identity(audio, start, length)
    stems, rows, mism = mix.assemble(song, audio, start, length)
    _fmt_rows(rows)
    log(f"  render: {len(rows)} parts, {mix.LOOP_PASSES} passes of {length} samples on the 64-sample grid; "
        f"last two passes differ by {'nothing (bit-identical)' if ident <= -299 else f'{ident:.1f} dB re peak'}"
        f"; seam safety crossfade {'idle' if mism <= -299 else f'used ({mism:.1f} dB)'}")
    stems = {k: mix.fit_loop(v, n_out) for k, v in stems.items()}
    m: Master = cfg["master"]
    result = {}
    if len(cfg["stems"]) == 1:
        raw = stems["main"]
        out_path = os.path.join(OUT_DIR, cfg["stems"]["main"])
        y, dec, stats, ceiling, tp = _encode_with_peak_guard(
            lambda c: mix.master(raw, m, loop=True, ceiling=c), tmp, out_path, name, m.ceiling)
        log(f"  master: gain {stats['gain_db']:+.1f} dB, PLR in {stats['plr_in']:.1f} dB, "
            f"comp GR mean {stats.get('comp_gr_mean', 0):.2f}/max {stats.get('comp_gr_max', 0):.2f} dB, "
            f"limiter max {stats['lim_gr_max']:.2f} dB active {stats['lim_active_pct']:.2f}% of the time, "
            f"ceiling {ceiling:.2f} dBTP")
        log(f"  encoded {cfg['stems']['main']}: {len(dec)} samples, {dsp.lufs(dec, periodic=True):.2f} LUFS, "
            f"true peak {tp:.2f} dBTP, {os.path.getsize(out_path) / 1024:.0f} kB")
        result["main"] = dec
    else:
        result = _build_stem_pair(name, cfg, stems, m, tmp)
    log(f"  done in {time.time() - t0:.1f} s")
    return result


def _build_stem_pair(name, cfg, stems, m: Master, tmp) -> dict:
    """m01: two stems that are summed by the game.  Both get only *linear* bus
    processing so that base + combat is exactly the intended full mix."""
    base = mix.bus_linear(stems["base"], m, loop=True)
    combat = mix.bus_linear(stems["combat"], m, loop=True)
    base = base * dsp.lin(m.target - dsp.lufs(base, periodic=True))
    g = mix.solve_gain(base, combat, cfg["sum_target"])
    log(f"  stems: base -> {m.target:.1f} LUFS; combat gain {g:+.2f} dB relative to the written balance "
        f"so that base+combat = {cfg['sum_target']:.1f} LUFS")
    combat = combat * dsp.lin(g)
    paths = {k: os.path.join(OUT_DIR, f) for k, f in cfg["stems"].items()}
    scale = 0.0
    for attempt in range(5):
        k = dsp.lin(scale)
        # individual safety limiters (normally idle: the stems have headroom)
        yb, grb = dsp.periodic(dsp.limit, base * k, ceiling_db=m.ceiling)
        yc, grc = dsp.periodic(dsp.limit, combat * k, ceiling_db=m.ceiling)
        db_, tpb = mix.encode_checked(yb, tmp, paths["base"], name + "_base")
        dc_, tpc = mix.encode_checked(yc, tmp, paths["combat"], name + "_combat")
        sum_pk = dsp.sample_peak_db(db_ + dc_)
        over = max(tpb - TP_AIM, tpc - TP_AIM, sum_pk - SUM_PEAK_AIM)
        if over <= 0.05:
            break
        scale -= over + 0.05
    if scale < 0:
        log(f"  ! both stems lowered by {-scale:.2f} dB to keep the summed peak legal")
    log(f"  limiters: base max GR {grb.max():.2f} dB, combat max GR {grc.max():.2f} dB")
    log(f"  encoded base: {dsp.lufs(db_, periodic=True):.2f} LUFS, TP {tpb:.2f} | combat: "
        f"{dsp.lufs(dc_, periodic=True):.2f} LUFS, TP {tpc:.2f} | sum: {dsp.lufs(db_ + dc_, periodic=True):.2f} LUFS, "
        f"sample peak {sum_pk:.2f} dBFS, TP {dsp.true_peak_db(db_ + dc_):.2f}")
    return {"base": db_, "combat": dc_}


# ---------------------------------------------------------------- stingers

def build_stingers(which: list[str], args) -> None:
    songs = importlib.import_module("tracks.stingers").build()
    for name in which:
        t0 = time.time()
        fname, seconds, fade = STINGERS[name]
        song = songs[name]
        tmp = os.path.join(args.tmp, "sting_" + name)
        log(f"\n=== sting_{name}: {song.key}, {seconds:.1f} s ===")
        _lint(song, args.lint)
        audio, start, length = mix.render_parts(song, tmp, jobs=args.jobs, cache=not args.no_cache,
                                                tail_s=seconds + 3.0)
        stems, rows, _ = mix.assemble(song, audio, start, length)
        _fmt_rows(rows)
        raw, info = mix.trim_sting(stems["main"], seconds, fade_out=fade)
        out_path = os.path.join(OUT_DIR, fname)
        y, dec, stats, ceiling, tp = _encode_with_peak_guard(
            lambda c: mix.master(raw, STING_MASTER, loop=False, ceiling=c), tmp, out_path,
            "sting_" + name, STING_MASTER.ceiling)
        # the master chain is causal, so the fade to silence survives it; make
        # sure of the very last samples anyway
        log(f"  tail is {info['tail_rel_db']:.1f} dB below peak where the fade-out starts")
        log(f"  master: gain {stats['gain_db']:+.1f} dB, PLR in {stats['plr_in']:.1f} dB, limiter max "
            f"{stats['lim_gr_max']:.2f} dB active {stats['lim_active_pct']:.2f}%, ceiling {ceiling:.2f} dBTP")
        log(f"  encoded {fname}: {len(dec) / SR:.3f} s, {dsp.lufs(dec):.2f} LUFS, true peak {tp:.2f} dBTP, "
            f"{os.path.getsize(out_path) / 1024:.0f} kB  ({time.time() - t0:.1f} s)")


# ---------------------------------------------------------------- manifest

def _ogg_seconds(path: str) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=duration_ts",
                          "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip()
    return int(out.split(",")[0]) / SR


def write_manifest() -> None:
    tracks = {}
    for name, cfg in LOOPS.items():
        mod = importlib.import_module(cfg["module"])
        samples = int(round(mod.BARS * 4 * 60.0 / mod.BPM * SR))
        tracks[name] = {
            "bpm": mod.BPM, "bars": mod.BARS, "beatsPerBar": 4,
            "loopSeconds": round(samples / SR, 6),
            "stems": dict(cfg["stems"]),
        }
    stingers = {}
    for name, (fname, seconds, _) in STINGERS.items():
        path = os.path.join(OUT_DIR, fname)
        secs = _ogg_seconds(path) if os.path.exists(path) else seconds
        stingers[name] = {"file": fname, "seconds": round(secs, 4)}
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, "w") as f:
        json.dump({"tracks": tracks, "stingers": stingers}, f, indent=2)
        f.write("\n")
    log(f"\nwrote {os.path.relpath(MANIFEST, ROOT)}")


# -------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", action="append", default=[],
                    help="build just this track/stinger (repeatable)")
    ap.add_argument("--tmp", default="/tmp/emg-music", help="directory for intermediate MIDI/WAV")
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 2)
    ap.add_argument("--no-cache", action="store_true", help="re-render every stem")
    ap.add_argument("--no-verify", action="store_true", help="skip tools/music/verify.py")
    ap.add_argument("--lint", action="store_true", help="print every lint finding")
    args = ap.parse_args()

    want_loops, want_stings = [], []
    if not args.only:
        want_loops, want_stings = list(LOOPS), list(STINGERS)
    for item in args.only:
        key = item.replace("sting_", "").replace(".ogg", "")
        if key in LOOPS:
            want_loops.append(key)
        elif key == "stingers":
            want_stings += list(STINGERS)
        elif key in STINGERS:
            want_stings.append(key)
        else:
            ap.error(f"unknown track {item!r}; choose from {', '.join(list(LOOPS) + ['stingers'] + list(STINGERS))}")

    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(args.tmp, exist_ok=True)
    t0 = time.time()
    for name in want_loops:
        build_loop(name, LOOPS[name], args)
    if want_stings:
        build_stingers(want_stings, args)
    write_manifest()
    log(f"build finished in {time.time() - t0:.1f} s")
    if args.no_verify:
        return 0
    cmd = [sys.executable, os.path.join(HERE, "verify.py"), "--tmp", args.tmp]
    return subprocess.call(cmd)


if __name__ == "__main__":
    sys.exit(main())
