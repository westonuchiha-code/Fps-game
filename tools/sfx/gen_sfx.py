#!/usr/bin/env python3
"""Procedural sound-effect generator for EVERYTHING MUST GO.

    python3 tools/sfx/gen_sfx.py                  # regenerate the whole set
    python3 tools/sfx/gen_sfx.py --only pistol    # only names starting with "pistol"
    python3 tools/sfx/gen_sfx.py --list           # show the sound table

Every sound is synthesised from layers with numpy/scipy (see dsp.py, kit.py and
the sounds_*.py recipe modules), finished (trim, fade, DC fix, normalise),
encoded with ffmpeg/libvorbis (-q:a 5, mono, 44.1 kHz) into
public/audio/sfx/ and described in src/data/sfx-manifest.json.

The output is deterministic: each file is seeded from its name and variation
number, so regenerating (fully or with --only) reproduces the same audio.
Intermediate WAVs are kept in /tmp/emg-sfx/wav (override with $EMG_SFX_TMP).
Run tools/sfx/verify.py afterwards to check the result against the spec.
"""
from __future__ import annotations

import argparse
import importlib
import json
import math
import os
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

import dsp  # noqa: E402
from registry import REGISTRY  # noqa: E402
from spec import BY_NAME, LOOP_LUFS, LOOP_PEAK_DBFS, PEAK_DBFS, SPECS, SR  # noqa: E402

RECIPE_MODULES = [
    "sounds_weapons",
    "sounds_impacts",
    "sounds_ui",
    "sounds_loot",
    "sounds_explosives",
    "sounds_player",
    "sounds_enemies",
    "sounds_vehicles",
    "sounds_world",
]
for _m in RECIPE_MODULES:
    importlib.import_module(_m)

OUT_DIR = os.path.join(ROOT, "public", "audio", "sfx")
MANIFEST = os.path.join(ROOT, "src", "data", "sfx-manifest.json")
TMP_DIR = os.environ.get("EMG_SFX_TMP", "/tmp/emg-sfx")
WAV_DIR = os.path.join(TMP_DIR, "wav")

# Required encode settings are "-c:a libvorbis -q:a 5", mono, 44.1 kHz.  The rest:
#  * +bitexact / -map_metadata -1: byte-identical files on every run (no random
#    Ogg serial number, no encoder tag).
#  * -page_duration 10000: short Ogg pages.  With ffmpeg's default (1 s pages) a
#    short file is a single page, and ffmpeg-based decoders (the ffmpeg CLI and
#    Chrome's decodeAudioData) then mis-trim the end of the stream by up to
#    +-128 samples.  That is harmless for one-shots but would break the period
#    of a loop; 10 ms pages make every decoder return the exact sample count.
FFMPEG_ENCODE = [
    "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
    "-c:a", "libvorbis", "-q:a", "5", "-ac", "1", "-ar", str(SR),
    "-page_duration", "10000",
]


# --------------------------------------------------------------------------
# finishing
# --------------------------------------------------------------------------
def default_fade(spec) -> float:
    """Fade-out length when a recipe does not ask for one: 20 % of a typical length, 8-80 ms."""
    return min(max(0.2 * 0.5 * (spec.dur_min + spec.dur_max), 0.008), 0.08)


def finalize_oneshot(x: np.ndarray, spec, fade_s: float) -> np.ndarray:
    """DC-block, trim leading silence, fade the tail to true zero, peak-normalise."""
    x = dsp.bhp(np.asarray(x, dtype=float), 20.0, 2)
    pk = dsp.peak(x)
    if not np.isfinite(pk) or pk <= 0.0:
        raise ValueError(f"{spec.name}: silent or non-finite render")
    # start within 2 ms: the first sample above -34 dB re. peak lands on sample <= 4
    first = int(np.argmax(np.abs(x) >= 0.02 * pk))
    x = x[max(0, first - 4):]
    dur = len(x) / SR
    if not (spec.dur_min <= dur <= spec.dur_max):
        raise ValueError(f"{spec.name}: duration {dur:.3f}s outside {spec.dur_min}-{spec.dur_max}s")
    x = dsp.fade(x, 0.0, min(fade_s, dur))
    x[-1] = 0.0
    # remove what is left of the mean with a pedestal that is zero at both ends
    n = len(x)
    ramp = min(dsp.ns(0.004), n // 4)
    w = np.ones(n)
    w[:ramp] = 0.5 - 0.5 * np.cos(np.pi * np.arange(ramp) / ramp)
    w[n - ramp:] = w[:ramp][::-1]
    w[-1] = 0.0
    x = x - (float(np.sum(x)) / float(np.sum(w))) * w
    return x * (dsp.db(PEAK_DBFS) / dsp.peak(x))


def finalize_loop(x: np.ndarray, spec, ceiling_db: float) -> np.ndarray:
    """Zero-mean, loudness-normalise to LOOP_LUFS, keep peaks under the ceiling.

    Only gain changes and a tiled look-ahead limiter are used, so an exactly
    periodic input stays exactly periodic (the seam is untouched)."""
    x = np.asarray(x, dtype=float)
    dur = len(x) / SR
    if not (spec.dur_min - 1e-9 <= dur <= spec.dur_max + 1e-9):
        raise ValueError(f"{spec.name}: loop duration {dur:.4f}s outside {spec.dur_min}-{spec.dur_max}s")
    x = x - float(np.mean(x))
    ceil = dsp.db(ceiling_db)
    for _ in range(12):
        x = x * dsp.db(LOOP_LUFS - dsp.loop_lufs(x))
        if dsp.peak(x) <= ceil * 1.0005:
            break
        x = dsp.loop_apply(lambda z: dsp.limiter(z, ceil, 3.0), x)
        x = x - float(np.mean(x))
    return x


def seam_score(y: np.ndarray) -> float:
    """Step and kink across the wrap-around relative to the loop's own (99.9th percentile)
    sample-to-sample motion.  Well below 1 means the seam is indistinguishable from the body."""
    d1 = np.abs(np.diff(y))
    d2 = np.abs(y[2:] - 2.0 * y[1:-1] + y[:-2])
    jump = abs(float(y[0] - y[-1]))
    kink = max(abs(float(y[0] - 2.0 * y[-1] + y[-2])), abs(float(y[1] - 2.0 * y[0] + y[-1])))
    return max(jump / (float(np.percentile(d1, 99.9)) + 1e-6), kink / (float(np.percentile(d2, 99.9)) + 1e-6))


def seam_candidates(x: np.ndarray, count: int = 6) -> list[int]:
    """Loop-start offsets worth trying: the quietest moments of the cycle (4 ms local level),
    at least 20 ms apart, each nudged to the nearby sample with the smallest value and slope."""
    n = len(x)
    w = dsp.ns(0.004)
    c = np.cumsum(np.concatenate([[0.0], np.concatenate([x[-w:], x, x[:w]]) ** 2]))
    local = c[2 * w:2 * w + n] - c[:n]
    picks: list[int] = []
    gap = dsp.ns(0.02)
    for i in np.argsort(local, kind="stable"):
        if all(min(abs(int(i) - q), n - abs(int(i) - q)) >= gap for q in picks):
            picks.append(int(i))
            if len(picks) == count:
                break
    out = []
    r = dsp.ns(0.002)
    for i in picks:
        idx = np.arange(i - r, i + r + 1) % n
        cost = np.abs(x[idx]) + np.abs(x[idx] - x[(idx - 1) % n])
        out.append(int(idx[int(np.argmin(cost))]))
    return out


# --------------------------------------------------------------------------
# encode / decode
# --------------------------------------------------------------------------
def encode(x: np.ndarray, wav_path: str, ogg_path: str) -> np.ndarray:
    """Write the float WAV master, encode it to OGG Vorbis, return the decoded audio."""
    sf.write(wav_path, x.astype(np.float32), SR, subtype="FLOAT")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", wav_path, *FFMPEG_ENCODE, ogg_path],
                   check=True)
    y, sr = sf.read(ogg_path, dtype="float64")
    if sr != SR or y.ndim != 1:
        raise RuntimeError(f"{ogg_path}: unexpected format after encode")
    return y


def fit_peak(x0: np.ndarray, wav_path: str, ogg_path: str, target: float, tol_db: float = 0.08):
    """Encode x0 with the gain that makes the *decoded* file peak at `target`.

    The codec re-draws noise-like material, so the decoded peak moves by a few tenths of
    a dB in a level-dependent, non-monotonic way: bracket + bisect first, then scan small
    offsets around the best try.  Returns (encoded input, decoded audio, encode count)."""
    tried: dict[float, float] = {}

    def attempt(gain: float) -> float:
        y = encode(x0 * gain, wav_path, ogg_path)
        tried[gain] = dsp.to_db(dsp.peak(y) / target)
        return tried[gain]

    gain, lo, hi = 1.0, None, None
    for _ in range(7):
        err = attempt(gain)
        if abs(err) <= tol_db:
            break
        if err > 0:
            hi = gain if hi is None else min(hi, gain)
        else:
            lo = gain if lo is None else max(lo, gain)
        if lo is not None and hi is not None and lo < hi and hi / lo > 1.001:
            gain = math.sqrt(lo * hi)
        else:
            gain *= dsp.db(-err)
    else:
        g0, e0 = min(tried.items(), key=lambda kv: abs(kv[1]))
        for off in (0.0, -0.06, 0.06, -0.13, 0.13, -0.21, 0.21, -0.3, 0.3):
            g = g0 * dsp.db(-e0 + off)
            if g in tried:
                continue
            if abs(attempt(g)) <= tol_db:
                break
    best_gain = min(tried.items(), key=lambda kv: abs(kv[1]))[0]
    x = x0 * best_gain
    y = encode(x, wav_path, ogg_path)        # deterministic: reproduces the best try
    return x, y, len(tried) + 1


def render_one(task: tuple[str, int]) -> dict:
    """Synthesise, finish and encode one file.  Runs in a worker process."""
    name, v = task
    spec = BY_NAME[name]
    fn, fade_s, rotate = REGISTRY[name]
    rng = np.random.default_rng(dsp.seed_for(name, v))
    t0 = time.time()
    raw = fn(rng, dsp.Jit(rng, 0.05), v)
    fname = spec.files()[v]
    wav_path = os.path.join(WAV_DIR, fname[:-4] + ".wav")
    ogg_path = os.path.join(OUT_DIR, fname)
    info = {"name": name, "v": v, "file": fname, "loop": spec.loop}

    if spec.loop:
        # the lossy codec moves peaks a little: back the ceiling off until the decoded file obeys it
        ceiling = LOOP_PEAK_DBFS - 0.5
        encodes = 0
        for _round in range(6):
            x0 = finalize_loop(raw, spec, ceiling)
            # The loop is exactly periodic, so the file may start anywhere in the cycle.  The
            # codec's error at the two ends of the stream is independent, which can leave a
            # small step at the wrap-around: try a few quiet, near-zero-crossing loop points
            # and keep the one whose *decoded* seam is smoothest.
            best = None
            for off in [0] + (seam_candidates(x0) if rotate else []):
                y = encode(np.roll(x0, -off), wav_path, ogg_path)
                encodes += 1
                score = seam_score(y)
                if best is None or score < best[0]:
                    best = (score, off)
                if score < 0.2:
                    break
            x = np.roll(x0, -best[1])
            y = encode(x, wav_path, ogg_path)
            encodes += 1
            if dsp.to_db(dsp.peak(y)) <= LOOP_PEAK_DBFS - 0.02:
                break
            ceiling -= max(0.15, dsp.to_db(dsp.peak(y)) - LOOP_PEAK_DBFS + 0.1)
        it = encodes - 1
        info.update(lufs=round(dsp.loop_lufs(y), 2), loop_start_offset=best[1], seam_score=round(best[0], 3))
    else:
        target = dsp.db(PEAK_DBFS)
        fade = default_fade(spec) if fade_s is None else fade_s
        encodes = 0
        for _round in range(6):
            x, y, used = fit_peak(finalize_oneshot(raw, spec, fade), wav_path, ogg_path, target)
            encodes += used
            # Vorbis spreads quantisation noise over a whole block, so a sound that is still
            # loud ~40 ms before its end leaves a noise floor under the fade.  If the decoded
            # tail is not properly silent, lengthen the fade and go again.
            tail_abs = dsp.to_db(dsp.peak(y[-dsp.ns(0.002):]))
            tail_rel = dsp.to_db(dsp.rms(y[-dsp.ns(0.005):]) / dsp.peak(y))
            if (tail_abs <= -52.0 and tail_rel <= -42.0) or fade >= 0.6 * len(x) / SR:
                break
            fade = min(fade * 1.4, 0.6 * len(x) / SR)
        it = encodes - 1
        info["fade"] = round(fade, 4)
    if len(y) != len(x):
        raise RuntimeError(f"{fname}: decoded length {len(y)} != rendered length {len(x)}")
    info.update(samples=len(y), dur=len(y) / SR, peak_db=round(dsp.to_db(dsp.peak(y)), 2), encodes=it + 1,
                bytes=os.path.getsize(ogg_path), secs=round(time.time() - t0, 2))
    return info


# --------------------------------------------------------------------------
# manifest
# --------------------------------------------------------------------------
def write_manifest(entries: dict[str, dict]) -> None:
    """One sound per line, in spec order: { name: { files, dur, loop } }."""
    lines = []
    for spec in SPECS:
        e = entries.get(spec.name)
        if e is None:
            continue
        files = ", ".join(json.dumps(f) for f in e["files"])
        lines.append(f'  {json.dumps(spec.name)}: {{ "files": [{files}], "dur": {e["dur"]:.3f}, '
                     f'"loop": {"true" if e["loop"] else "false"} }}')
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        fh.write("{\n" + ",\n".join(lines) + "\n}\n")


def existing_entry(spec) -> dict | None:
    """Manifest entry for a sound that was not regenerated in this run (measured from disk)."""
    longest = 0
    for f in spec.files():
        p = os.path.join(OUT_DIR, f)
        if not os.path.exists(p):
            return None
        longest = max(longest, sf.info(p).frames)
    return {"files": spec.files(), "dur": round(longest / SR, 3), "loop": spec.loop}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", action="append", default=[], metavar="PREFIX",
                    help="only regenerate sounds whose name starts with PREFIX (repeatable, comma-separated)")
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 2, help="worker processes (default: all cores)")
    ap.add_argument("--list", action="store_true", help="list the sound table and exit")
    args = ap.parse_args()

    extra = [n for n in REGISTRY if n not in BY_NAME]
    if extra:
        print(f"recipes that are not in the spec: {extra}", file=sys.stderr)
        return 2

    if args.list:
        for s in SPECS:
            print(f"{s.name:20s} x{s.variations}  {s.dur_min:g}-{s.dur_max:g}s  {'LOOP' if s.loop else ''}  [{s.family}]")
        print(f"{len(SPECS)} sounds, {sum(s.variations for s in SPECS)} files")
        return 0

    prefixes = [p for arg in args.only for p in arg.split(",") if p]
    chosen = [s for s in SPECS if not prefixes or any(s.name.startswith(p) for p in prefixes)]
    if not chosen:
        print(f"no sound matches --only {prefixes}", file=sys.stderr)
        return 2
    missing = [s.name for s in chosen if s.name not in REGISTRY]
    if missing:
        print(f"no recipe registered for: {missing}", file=sys.stderr)
        return 2

    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(WAV_DIR, exist_ok=True)
    tasks = [(s.name, v) for s in chosen for v in range(s.variations)]
    # longest first so the pool stays busy
    tasks.sort(key=lambda t: -BY_NAME[t[0]].dur_max)

    t0 = time.time()
    results: list[dict] = []
    if args.jobs <= 1 or len(tasks) == 1:
        for t in tasks:
            results.append(render_one(t))
    else:
        with ProcessPoolExecutor(max_workers=args.jobs) as pool:
            for r in pool.map(render_one, tasks, chunksize=1):
                results.append(r)

    by_name: dict[str, list[dict]] = {}
    for r in results:
        by_name.setdefault(r["name"], []).append(r)

    entries: dict[str, dict] = {}
    for spec in SPECS:
        if spec.name in by_name:
            rs = sorted(by_name[spec.name], key=lambda r: r["v"])
            entries[spec.name] = {"files": [r["file"] for r in rs],
                                  "dur": round(max(r["samples"] for r in rs) / SR, 3), "loop": spec.loop}
        else:
            e = existing_entry(spec)
            if e is not None:
                entries[spec.name] = e
    write_manifest(entries)

    # a full run owns the output folder: drop stale files (e.g. after a variation count change)
    if not prefixes:
        wanted = {f for s in SPECS for f in s.files()}
        for f in sorted(os.listdir(OUT_DIR)):
            if f.endswith(".ogg") and f not in wanted:
                os.remove(os.path.join(OUT_DIR, f))
                print(f"removed stale {f}")

    with open(os.path.join(TMP_DIR, "build.json"), "w", encoding="utf-8") as fh:
        json.dump(sorted(results, key=lambda r: r["file"]), fh, indent=1)

    total = sum(os.path.getsize(os.path.join(OUT_DIR, f)) for f in os.listdir(OUT_DIR) if f.endswith(".ogg"))
    print(f"generated {len(results)} files for {len(by_name)} sounds in {time.time() - t0:.1f}s "
          f"-> {os.path.relpath(OUT_DIR, ROOT)} (folder total {total / 1e6:.2f} MB); "
          f"manifest has {len(entries)}/{len(SPECS)} sounds")
    return 0


if __name__ == "__main__":
    sys.exit(main())
