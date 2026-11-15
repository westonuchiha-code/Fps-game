#!/usr/bin/env python3
"""Automated quality gate for the music in public/audio/music/.

    python3 tools/music/verify.py            # all checks, table, exit 1 on failure
    python3 tools/music/verify.py --detail   # + spectrum bands and per-section loudness
    python3 tools/music/verify.py --synth    # + self-test of the FluidSynth scheduling model

Every OGG is decoded again (ffmpeg, cross-checked with libsndfile) and tested:

  format     Ogg Vorbis, stereo, 44.1 kHz
  length     loops: decoded sample count == round(bars*beatsPerBar*60/bpm*44100)
             and equals manifest loopSeconds; m01 stems have identical length;
             stingers lie inside their specified duration window
  seam       loops: last 64 samples joined to the first 64 -- the jump across
             the join is compared with the local sample-to-sample deltas
  peaks      true peak <= -1.0 dBTP per file (own 4x meter AND ffmpeg ebur128);
             m01_base + m01_combat summed sample-wise <= -0.5 dBFS
  loudness   integrated LUFS (ffmpeg ebur128, cross-checked with own BS.1770
             meter): menu / m01_base -17, drive / boss / m01 sum -15, stingers -14
  hygiene    no DC offset, not silent, no long dropouts, no clipping runs
  spectrum   bass (50-120 Hz) present, presence/air bands not harsh
  manifest   src/data/music-manifest.json matches the files
  size       all OGGs together stay under 9 MB
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

from emg import SR, dsp, mix  # noqa: E402

OUT_DIR = os.path.join(ROOT, "public", "audio", "music")
MANIFEST = os.path.join(ROOT, "src", "data", "music-manifest.json")

LUFS_TOL = 1.0
TP_LIMIT = -1.0
SUM_PEAK_LIMIT = -0.5
SIZE_LIMIT = 9 * 1024 * 1024
LOOP_TARGETS = {"menu.ogg": -17.0, "m01_base.ogg": -17.0, "drive.ogg": -15.0, "boss.ogg": -15.0}
M01_SUM_TARGET = -15.0
STING_TARGET = -14.0
STING_WINDOWS = {"start": (4.0, 6.0), "complete": (8.0, 10.0), "death": (3.0, 5.0),
                 "objective": (1.5, 2.5)}
# stems / one-shots that are not expected to carry bass on their own
NO_BASS_REQUIRED = {"m01_combat.ogg", "sting_objective.ogg"}


class Report:
    def __init__(self):
        self.fails: list[str] = []
        self.notes: list[str] = []

    def check(self, ok: bool, msg: str) -> bool:
        if not ok:
            self.fails.append(msg)
        return ok


def ffprobe(path: str) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
         "stream=codec_name,sample_rate,channels,duration_ts", "-of", "json", path],
        capture_output=True, text=True).stdout
    st = json.loads(out)["streams"][0]
    return {"codec": st["codec_name"], "rate": int(st["sample_rate"]),
            "channels": int(st["channels"]), "samples": int(st.get("duration_ts", 0))}


def ebur128(path: str) -> tuple[float, float, float]:
    """(integrated LUFS, loudness range LU, true peak dBTP) measured by ffmpeg."""
    err = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true",
         "-f", "null", "-"], capture_output=True, text=True).stderr
    summ = err[err.rindex("Summary:"):]
    i = float(re.search(r"I:\s+(-?[\d.]+) LUFS", summ).group(1))
    lra = float(re.search(r"LRA:\s+(-?[\d.]+) LU", summ).group(1))
    tp = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", summ).group(1))
    return i, lra, tp


def hygiene(rep: Report, name: str, x: np.ndarray, loop: bool) -> dict:
    dc = float(np.abs(x.mean(axis=0)).max())
    rms = dsp.db(float(np.sqrt((x ** 2).mean())))
    runs = dsp.clip_runs(x)
    gap = dsp.longest_silence(x[: len(x) - int(0.6 * SR)] if not loop else x, -60.0)
    rep.check(dc < 1e-3, f"{name}: DC offset {dc:.5f}")
    rep.check(rms > -45.0, f"{name}: (nearly) silent, rms {rms:.1f} dBFS")
    rep.check(runs == 0, f"{name}: {runs} clipping runs")
    rep.check(gap < (1.5 if loop else 1.0), f"{name}: {gap:.2f} s of silence inside the file")
    return {"dc": dc, "rms": rms, "runs": runs, "gap": gap}


def spectrum(rep: Report, name: str, x: np.ndarray) -> dict:
    b = dsp.spectrum_bands(x)
    if name not in NO_BASS_REQUIRED:
        rep.check(b["bass50-120"] > -20.0, f"{name}: bass band weak ({b['bass50-120']:.1f} dB re total)")
    rep.check(b["pres2k-6k"] < -7.0, f"{name}: presence band hot ({b['pres2k-6k']:.1f} dB re total) -- harsh")
    rep.check(b["air6k-16k"] < -13.0, f"{name}: air band hot ({b['air6k-16k']:.1f} dB re total) -- harsh")
    return b


def seam(rep: Report, name: str, x: np.ndarray) -> dict:
    r = dsp.seam_report(x, 64)
    # a click would be a jump many times the local deltas; the codec alone keeps
    # the join within about twice the typical delta of the surrounding audio
    ok = r["jump"] <= max(3.0 * r["typical"], 1.25 * r["maxlocal"], 2e-4)
    rep.check(ok, f"{name}: discontinuity at loop seam (jump {r['jump']:.5f}, typical local delta "
                  f"{r['typical']:.5f}, max local {r['maxlocal']:.5f})")
    ok2 = r["curv"] <= max(3.5 * r["curv_max_local"], 4e-4)
    rep.check(ok2, f"{name}: slope break at loop seam (curvature {r['curv']:.5f} vs local max "
                   f"{r['curv_max_local']:.5f})")
    return r


def section_profile(x: np.ndarray, bars: int, per: int = 4) -> list[float]:
    """Short-term loudness of each `per`-bar section of a loop."""
    n = len(x)
    out = []
    for b0 in range(0, bars, per):
        a = int(round(n * b0 / bars))
        b = int(round(n * min(bars, b0 + per) / bars))
        out.append(dsp.lufs(x[a:b]))
    return out


def check_synth_timing() -> tuple[bool, str]:
    """Self-test: does this FluidSynth build apply MIDI events exactly where
    emg.seq.tick_for_block() says (start of the requested 64-sample block)?"""
    import mido
    from emg.seq import BLOCK, PPQ, TEMPO_US, tick_for_block
    from emg.synth import render_midi
    # varied offsets within a block (residues), notes ~0.4 s apart so each one's
    # release has died away before the next; then blocks whose millisecond clock
    # lands exactly on an integer (block - 1 a multiple of 441)
    blocks = [400 + 331 * i + (i * i) % 53 for i in range(180)]
    blocks += [1 + 441 * m for m in range(blocks[-1] // 441 + 2, blocks[-1] // 441 + 9)]
    # keep the test notes apart (each lasts 20 blocks and needs a silent gap
    # after it for onset detection), so the MIDI events stay in time order
    kept = []
    for b in sorted(set(blocks)):
        if not kept or b - kept[-1] >= 250:
            kept.append(b)
    blocks = kept
    with tempfile.TemporaryDirectory() as td:
        mf = mido.MidiFile(type=1, ticks_per_beat=PPQ)
        tr = mido.MidiTrack()
        mf.tracks.append(tr)
        tr.append(mido.MetaMessage("set_tempo", tempo=TEMPO_US, time=0))
        tr.append(mido.Message("program_change", channel=0, program=115, time=0))
        last = 0
        for b in blocks:
            t_on, t_off = tick_for_block(b), tick_for_block(b + 20)
            tr.append(mido.Message("note_on", channel=0, note=84, velocity=120, time=t_on - last))
            tr.append(mido.Message("note_off", channel=0, note=84, velocity=0, time=t_off - t_on))
            last = t_off
        tr.append(mido.MetaMessage("end_of_track", time=44100))
        mid = os.path.join(td, "t.mid")
        mf.save(mid)
        x = render_midi(mid, os.path.join(td, "t.wav"))
    a = np.abs(x).max(axis=1)
    # release tails decay towards (not to) zero in float output: an onset is the
    # first non-zero sample after a stretch of near-silence
    quiet = a < 1e-5
    idx = np.flatnonzero(~quiet)
    starts = [idx[0]] + [idx[i] for i in range(1, len(idx)) if idx[i] - idx[i - 1] > 2000]
    onsets = []
    for st in starts:
        k = st
        while k > 0 and a[k - 1] > 0:
            k -= 1
        onsets.append(k)
    if len(onsets) != len(blocks):
        return False, f"expected {len(blocks)} onsets, found {len(onsets)}"
    offs = sorted({int(o - b * BLOCK) for o, b in zip(onsets, blocks)})
    ok = len(offs) == 1
    return ok, (f"all {len(blocks)} events landed exactly on their 64-sample block "
                f"(first non-zero sample at block start + {offs[0]})" if ok
                else f"events landed at varying offsets from their block: {offs[:8]}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tmp", default="/tmp/emg-music")
    ap.add_argument("--detail", action="store_true", help="print spectrum bands and section loudness")
    ap.add_argument("--synth", action="store_true", help="also self-test FluidSynth event scheduling")
    args = ap.parse_args()

    rep = Report()
    if not os.path.exists(MANIFEST):
        print(f"FAIL: {MANIFEST} is missing")
        return 1
    man = json.load(open(MANIFEST))
    rows = []
    decoded = {}
    detail = []
    total_size = 0

    def measure(fname: str, loop: bool, target: float, expect_samples: int | None = None):
        nonlocal total_size
        path = os.path.join(OUT_DIR, fname)
        if not rep.check(os.path.exists(path), f"{fname}: file missing"):
            return None
        total_size += os.path.getsize(path)
        info = ffprobe(path)
        rep.check(info["codec"] == "vorbis" and info["rate"] == SR and info["channels"] == 2,
                  f"{fname}: expected Ogg Vorbis stereo 44.1 kHz, got {info}")
        x = mix.decode_ogg(path)
        decoded[fname] = x
        alt, alt_sr = sf.read(path, always_2d=True)
        rep.check(len(alt) == len(x), f"{fname}: ffmpeg decodes {len(x)} samples, libsndfile {len(alt)}")
        if expect_samples is not None:
            rep.check(len(x) == expect_samples,
                      f"{fname}: decoded {len(x)} samples, expected {expect_samples}")
        i_ff, lra, tp_ff = ebur128(path)
        i_own = dsp.lufs(x)
        tp_own = dsp.true_peak_db(x, periodic=loop)
        pk = dsp.sample_peak_db(x)
        rep.check(abs(i_ff - i_own) < 0.3, f"{fname}: loudness meters disagree ({i_ff} vs {i_own:.2f})")
        rep.check(max(tp_ff, tp_own) <= TP_LIMIT + 0.005,
                  f"{fname}: true peak {max(tp_ff, tp_own):.2f} dBTP > {TP_LIMIT}")
        if target is not None:
            rep.check(abs(i_ff - target) <= LUFS_TOL,
                      f"{fname}: {i_ff:.1f} LUFS, target {target:.0f} +-{LUFS_TOL:.0f}")
        hyg = hygiene(rep, fname, x, loop)
        bands = spectrum(rep, fname, x)
        sm = seam(rep, fname, x) if loop else None
        if not loop:
            head = float(np.abs(x[:8]).max())
            tail = float(np.abs(x[-64:]).max())
            rep.check(head < 0.02, f"{fname}: does not start from silence ({head:.4f})")
            rep.check(tail < 0.003, f"{fname}: tail not faded to silence ({tail:.4f})")
        rows.append(dict(file=fname, dur=len(x) / SR, samples=len(x), peak=pk,
                         tp=max(tp_ff, tp_own), lufs=i_ff, target=target, lra=lra,
                         seam=(sm["ratio_rms"] if sm else None), dc=hyg["dc"]))
        detail.append((fname, bands, sm, x))
        return x

    # ---- loops
    for name, t in man["tracks"].items():
        n_expect = int(round(t["bars"] * t["beatsPerBar"] * 60.0 / t["bpm"] * SR))
        rep.check(abs(t["loopSeconds"] - n_expect / SR) < 5e-5,
                  f"manifest {name}: loopSeconds {t['loopSeconds']} != {n_expect / SR:.6f}")
        lens = []
        for stem, fname in t["stems"].items():
            target = LOOP_TARGETS.get(fname)
            x = measure(fname, True, target, n_expect)
            if x is not None:
                lens.append(len(x))
        rep.check(len(set(lens)) <= 1, f"{name}: stems differ in length {lens}")

    # ---- m01 sum
    if "m01_base.ogg" in decoded and "m01_combat.ogg" in decoded:
        b, c = decoded["m01_base.ogg"], decoded["m01_combat.ogg"]
        if len(b) == len(c):
            ssum = b + c
            os.makedirs(args.tmp, exist_ok=True)
            wav = os.path.join(args.tmp, "m01_sum_check.wav")
            mix.write_wav(wav, ssum)
            i_ff, lra, tp_ff = ebur128(wav)
            pk = dsp.sample_peak_db(ssum)
            rep.check(pk <= SUM_PEAK_LIMIT + 0.005,
                      f"m01 base+combat: sample peak {pk:.2f} dBFS > {SUM_PEAK_LIMIT}")
            rep.check(abs(i_ff - M01_SUM_TARGET) <= LUFS_TOL,
                      f"m01 base+combat: {i_ff:.1f} LUFS, target {M01_SUM_TARGET:.0f}")
            hygiene(rep, "m01 base+combat", ssum, True)
            bands = spectrum(rep, "m01 base+combat", ssum)
            sm = seam(rep, "m01 base+combat", ssum)
            rows.append(dict(file="m01 base+combat (sum)", dur=len(ssum) / SR, samples=len(ssum),
                             peak=pk, tp=max(tp_ff, dsp.true_peak_db(ssum, periodic=True)),
                             lufs=i_ff, target=M01_SUM_TARGET, lra=lra, seam=sm["ratio_rms"],
                             dc=float(np.abs(ssum.mean(axis=0)).max())))
            detail.append(("m01 base+combat (sum)", bands, sm, ssum))

    # ---- stingers
    for name, st in man["stingers"].items():
        x = measure(st["file"], False, STING_TARGET)
        if x is None:
            continue
        lo, hi = STING_WINDOWS[name]
        secs = len(x) / SR
        rep.check(lo <= secs <= hi, f"{st['file']}: {secs:.2f} s outside {lo}-{hi} s")
        rep.check(abs(st["seconds"] - secs) < 2e-3,
                  f"manifest sting {name}: seconds {st['seconds']} != {secs:.4f}")

    rep.check(total_size <= SIZE_LIMIT, f"total size {total_size / 1e6:.2f} MB exceeds 9 MB")

    # ---- table
    print("\n file                    duration   samples    peak    true-pk   LUFS  target   LRA  seam*")
    print(" ----------------------  --------  --------  -------  -------  ------  ------  ----  -----")
    for r in rows:
        seam_s = f"{r['seam']:5.2f}" if r["seam"] is not None else "    -"
        tgt = f"{r['target']:6.1f}" if r["target"] is not None else "     -"
        print(f" {r['file']:<22s}  {r['dur']:7.3f}s  {r['samples']:8d}  {r['peak']:6.2f}   {r['tp']:6.2f}  "
              f"{r['lufs']:6.1f}  {tgt}  {r['lra']:4.1f}  {seam_s}")
    print(" peak/true-pk in dBFS/dBTP; LUFS integrated (ffmpeg ebur128); LRA in LU;")
    print(" *seam = jump across the loop join / RMS sample-to-sample delta of the 64 samples either side")
    print(f" total size of {len(decoded)} OGG files: {total_size / 1e6:.2f} MB")

    if args.detail:
        print("\n spectrum (dB re total): sub<50  bass50-120  lowmid120-400  mid400-2k  pres2k-6k  air6k-16k")
        for fname, bands, sm, x in detail:
            vals = "  ".join(f"{v:6.1f}" for v in bands.values())
            cr = np.corrcoef(x[:, 0], x[:, 1])[0, 1]
            print(f"  {fname:<22s} {vals}   L/R corr {cr:+.2f}")
        print("\n loudness per 4 bars (LUFS):")
        for name, t in man["tracks"].items():
            for stem, fname in t["stems"].items():
                if fname in decoded:
                    prof = section_profile(decoded[fname], t["bars"])
                    print(f"  {fname:<16s} " + " ".join(f"{v:6.1f}" for v in prof))
            if name == "m01" and "m01_base.ogg" in decoded and "m01_combat.ogg" in decoded:
                prof = section_profile(decoded["m01_base.ogg"] + decoded["m01_combat.ogg"], t["bars"])
                print(f"  {'m01 sum':<16s} " + " ".join(f"{v:6.1f}" for v in prof))
        print("\n seam detail (jump, typical delta, max local delta, level dBFS):")
        for fname, bands, sm, x in detail:
            if sm:
                print(f"  {fname:<22s} jump {sm['jump']:.5f}  typical {sm['typical']:.5f}  "
                      f"max local {sm['maxlocal']:.5f}  level {sm['level_db']:.1f}")

    if args.synth:
        ok, msg = check_synth_timing()
        rep.check(ok, f"FluidSynth scheduling model: {msg}")
        print(f"\n synth scheduling self-test: {'ok' if ok else 'FAILED'} -- {msg}")

    if rep.fails:
        print(f"\nVERIFY FAILED ({len(rep.fails)} problem{'s' if len(rep.fails) != 1 else ''}):")
        for f in rep.fails:
            print("  - " + f)
        return 1
    print("\nVERIFY OK: all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
