#!/usr/bin/env python3
"""Check the generated sound-effect set against the spec.

    python3 tools/sfx/verify.py               # all checks + spectrogram contact sheets
    python3 tools/sfx/verify.py --no-sheets   # checks only (fast)
    python3 tools/sfx/verify.py --only rifle  # restrict to a name prefix
    python3 tools/sfx/verify.py --report      # also write per-file metrics to /tmp/emg-sfx/report.tsv

For every required sound it checks (on the decoded OGG files, i.e. what the
game will actually play):

  * the file set: right names, right variation count, nothing extra, OGG Vorbis, mono, 44.1 kHz
  * the manifest entry (files, dur = longest variation rounded to 3 decimals, loop flag)
  * duration inside the spec'd range (heartbeat_loop: exactly 1.000 s)
  * no DC offset: |mean| < 0.002
  * variations are not copies of each other
  * one-shots: peak at -1 dBFS (+-0.3 dB), audible within 2 ms, tail faded to silence
  * loops: about -16 LUFS, peak <= -1 dBFS, and a continuous seam (sample step,
    high-frequency click test and level step across the wrap-around)
  * ffmpeg's decoder agrees with libsndfile on the sample count (ffmpeg is what
    Chrome's decodeAudioData uses; a mismatch would shift a loop's period)
  * total size of the folder (budget ~6 MB)

Spectrogram contact sheets (ffmpeg showspectrumpic, log-frequency, with a
waveform strip under each tile) are written to /tmp/emg-sfx/sheets/.
Exit status is non-zero if any check fails.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
from scipy import signal  # noqa: E402

import dsp  # noqa: E402
from spec import (BY_NAME, DC_LIMIT, LOOP_LUFS, LOOP_PEAK_DBFS, MAX_ONSET_S, PEAK_DBFS, SPECS, SR)  # noqa: E402

OUT_DIR = os.path.join(ROOT, "public", "audio", "sfx")
MANIFEST = os.path.join(ROOT, "src", "data", "sfx-manifest.json")
TMP_DIR = os.environ.get("EMG_SFX_TMP", "/tmp/emg-sfx")
WAV_DIR = os.path.join(TMP_DIR, "wav")
SHEET_DIR = os.path.join(TMP_DIR, "sheets")
SIZE_BUDGET = 6.0e6

PEAK_TOL_DB = 0.3
LUFS_TOL = 1.0
TAIL_ABS_DBFS = -50.0     # last 2 ms must be below this
TAIL_REL_DB = -40.0       # ... and the last 5 ms RMS this far below the peak


# --------------------------------------------------------------------------
# measurements
# --------------------------------------------------------------------------
def ffmpeg_decode_len(path: str) -> int:
    raw = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path, "-f", "f32le", "-ac", "1", "-"],
                         capture_output=True, check=True).stdout
    return len(raw) // 4


def onset_time(x: np.ndarray) -> float:
    """Time of the first sample that reaches 1 % of the peak (-40 dB)."""
    pk = dsp.peak(x)
    return float(np.argmax(np.abs(x) >= 0.01 * pk)) / SR


def envelope_db(x: np.ndarray) -> np.ndarray:
    from scipy.ndimage import maximum_filter1d, uniform_filter1d
    w = max(3, int(0.003 * SR))
    e = uniform_filter1d(maximum_filter1d(np.abs(x), size=w), size=w)
    return 20.0 * np.log10(np.maximum(e, 1e-9))


def describe(x: np.ndarray) -> dict:
    """Design descriptors used to sanity-check the sound design numerically."""
    n = len(x)
    pk = dsp.peak(x)
    r = dsp.rms(x)
    env = envelope_db(x)
    top = float(env.max())

    def last_above(level: float) -> float:
        idx = np.nonzero(env >= top + level)[0]
        return float(idx[-1]) / SR if len(idx) else 0.0

    edges = [0, 120, 500, 2000, 8000, SR / 2 + 1]

    def shares(seg: np.ndarray):
        sp = np.abs(np.fft.rfft(seg, max(len(seg), 4096))) ** 2
        fr = np.fft.rfftfreq(max(len(seg), 4096), 1.0 / SR)
        t = float(sp.sum()) + 1e-20
        return [100.0 * float(sp[(fr >= lo) & (fr < hi)].sum()) / t for lo, hi in zip(edges[:-1], edges[1:])], sp, fr, t

    bands, spec, f, tot = shares(x)
    onset_bands = shares(x[: min(n, int(0.06 * SR))])[0]     # spectral balance of the first 60 ms
    a, b = int(0.80 * n), int(0.90 * n)
    return {
        "dur": n / SR,
        "peak_db": dsp.to_db(pk),
        "rms_db": dsp.to_db(r),
        "crest_db": dsp.to_db(pk / max(r, 1e-12)),
        "rms50_db": dsp.to_db(dsp.rms(x[: min(n, int(0.05 * SR))]) / max(pk, 1e-12)),   # density of the first 50 ms
        "onset_ms": 1000.0 * onset_time(x),
        "t_peak_ms": 1000.0 * float(np.argmax(np.abs(x))) / SR,
        "t20_ms": 1000.0 * last_above(-20.0),
        "t40_ms": 1000.0 * last_above(-40.0),
        "centroid_hz": float((f * spec).sum() / tot),
        "sub": bands[0], "low": bands[1], "mid": bands[2], "high": bands[3], "air": bands[4],
        "on_sub": onset_bands[0], "on_low": onset_bands[1], "on_mid": onset_bands[2], "on_high": onset_bands[3],
        "on_air": onset_bands[4],
        "late_db": dsp.to_db(dsp.rms(x[a:b]) / max(pk, 1e-12)),
    }


def seam_metrics(x: np.ndarray) -> dict:
    """Continuity of a loop across its wrap-around point."""
    n = len(x)
    d1 = np.abs(np.diff(x))
    d2 = np.abs(x[2:] - 2.0 * x[1:-1] + x[:-2])
    jump = abs(float(x[0] - x[-1]))
    curve = max(abs(float(x[0] - 2.0 * x[-1] + x[-2])), abs(float(x[1] - 2.0 * x[0] + x[-1])))
    # high-frequency click detector over the wrapped signal
    m = min(8192, n // 2)
    sos = signal.butter(4, 4000.0 / (SR / 2), btype="high", output="sos")
    wrapped = signal.sosfiltfilt(sos, np.concatenate([x[-m:], x, x[:m]]))[m:-m]
    hf = np.abs(wrapped)
    seam_hf = float(max(hf[:24].max(), hf[-24:].max()))
    inner = hf[64:-64] if n > 256 else hf
    # level step across the seam compared with ordinary neighbouring windows
    w = int(0.03 * SR)
    k = n // w
    r = np.array([dsp.rms(x[i * w:(i + 1) * w]) for i in range(k)]) + 1e-9
    steps = np.abs(20.0 * np.log10(r[1:] / r[:-1])) if k > 2 else np.array([0.0])
    e_end, e_start = dsp.rms(x[-w:]) + 1e-9, dsp.rms(x[:w]) + 1e-9
    return {
        "jump": jump, "step_max": float(d1.max()), "step_p999": float(np.percentile(d1, 99.9)),
        "curve": curve, "curve_max": float(d2.max()),
        "seam_hf": seam_hf, "hf_max": float(inner.max()), "hf_p999": float(np.percentile(inner, 99.9)),
        "level_step_db": abs(20.0 * math.log10(e_start / e_end)),
        "level_step_p95": float(np.percentile(steps, 95)),
        "seam_level_db": dsp.to_db(max(e_end, e_start)),
    }


# --------------------------------------------------------------------------
# checks
# --------------------------------------------------------------------------
class Result:
    def __init__(self):
        self.fails: list[str] = []
        self.warns: list[str] = []

    def fail(self, where: str, msg: str):
        self.fails.append(f"{where}: {msg}")

    def warn(self, where: str, msg: str):
        self.warns.append(f"{where}: {msg}")


def check_file(spec, fname: str, res: Result) -> dict | None:
    path = os.path.join(OUT_DIR, fname)
    if not os.path.exists(path):
        res.fail(fname, "missing")
        return None
    info = sf.info(path)
    if info.format != "OGG" or info.subtype != "VORBIS":
        res.fail(fname, f"not OGG Vorbis ({info.format}/{info.subtype})")
    if info.channels != 1:
        res.fail(fname, f"{info.channels} channels (want mono)")
    if info.samplerate != SR:
        res.fail(fname, f"sample rate {info.samplerate} (want {SR})")
    y, _ = sf.read(path, dtype="float64", always_2d=True)
    x = y[:, 0]
    n = len(x)
    dur = n / SR
    m = describe(x)
    m.update(file=fname, name=spec.name, loop=spec.loop, samples=n, bytes=os.path.getsize(path))

    if spec.dur_min == spec.dur_max:
        if n != int(round(spec.dur_min * SR)):
            res.fail(fname, f"duration {dur:.5f}s, must be exactly {spec.dur_min:.3f}s")
    elif not (spec.dur_min - 1e-6 <= dur <= spec.dur_max + 1e-6):
        res.fail(fname, f"duration {dur:.3f}s outside {spec.dur_min:g}-{spec.dur_max:g}s")

    mean = float(np.mean(x))
    m["mean"] = mean
    if abs(mean) >= DC_LIMIT:
        res.fail(fname, f"DC offset |mean| = {abs(mean):.4f} (limit {DC_LIMIT})")

    ff_len = ffmpeg_decode_len(path)
    m["ffmpeg_len"] = ff_len
    if ff_len != n:
        (res.fail if spec.loop else res.warn)(fname, f"ffmpeg decodes {ff_len} samples, libsndfile {n}")

    if spec.loop:
        l = dsp.loop_lufs(x)
        m["lufs"] = l
        if m["peak_db"] > LOOP_PEAK_DBFS + 0.01:
            res.fail(fname, f"loop peak {m['peak_db']:.2f} dBFS above {LOOP_PEAK_DBFS} dBFS")
        if abs(l - LOOP_LUFS) > LUFS_TOL:
            res.fail(fname, f"loop loudness {l:.2f} LUFS, want {LOOP_LUFS} +-{LUFS_TOL}")
        s = seam_metrics(x)
        m["seam"] = s
        if s["jump"] > max(1.25 * s["step_max"], 2e-3):
            res.fail(fname, f"seam sample step {s['jump']:.4f} exceeds any in-loop step ({s['step_max']:.4f})")
        if s["curve"] > max(1.25 * s["curve_max"], 4e-3):
            res.fail(fname, f"seam kink {s['curve']:.4f} exceeds any in-loop curvature ({s['curve_max']:.4f})")
        if s["seam_hf"] > max(1.1 * s["hf_max"], 2e-3):
            res.fail(fname, f"seam click: HF {s['seam_hf']:.4f} above the loop's own maximum {s['hf_max']:.4f}")
        elif s["seam_hf"] > max(3.0 * s["hf_p999"], 2e-3):
            res.warn(fname, f"seam HF {s['seam_hf']:.4f} is high vs typical {s['hf_p999']:.4f}")
        if s["seam_level_db"] > -50.0 and s["level_step_db"] > max(3.0, 1.5 * s["level_step_p95"]):
            res.fail(fname, f"seam level step {s['level_step_db']:.1f} dB (ordinary steps <= {s['level_step_p95']:.1f} dB)")
    else:
        if abs(m["peak_db"] - PEAK_DBFS) > PEAK_TOL_DB:
            res.fail(fname, f"peak {m['peak_db']:.2f} dBFS, want {PEAK_DBFS} +-{PEAK_TOL_DB}")
        if m["onset_ms"] > MAX_ONSET_S * 1000.0:
            res.fail(fname, f"starts after {m['onset_ms']:.2f} ms (limit {MAX_ONSET_S * 1000:.0f} ms)")
        last2 = dsp.to_db(dsp.peak(x[-dsp.ns(0.002):]))
        last5 = dsp.to_db(dsp.rms(x[-dsp.ns(0.005):]) / dsp.peak(x))
        m["tail_last2ms_db"] = last2
        m["tail_last5ms_rel_db"] = last5
        if last2 > TAIL_ABS_DBFS or last5 > TAIL_REL_DB:
            res.fail(fname, f"tail not faded: last 2 ms peak {last2:.1f} dBFS, last 5 ms {last5:.1f} dB re. peak")
        wav = os.path.join(WAV_DIR, fname[:-4] + ".wav")
        if os.path.exists(wav):
            wx, _ = sf.read(wav, dtype="float64")
            if wx[-1] != 0.0:
                res.fail(fname, f"master WAV does not end on true zero ({wx[-1]:.2e})")
    m["_x"] = x
    return m


def check_variations(spec, metrics: list[dict], res: Result):
    xs = [m["_x"] for m in metrics]
    for i in range(len(xs)):
        for k in range(i + 1, len(xs)):
            a, b = xs[i], xs[k]
            if len(a) == len(b) and np.allclose(a, b, atol=1e-4):
                res.fail(spec.name, f"variations {i + 1} and {k + 1} are identical")
                continue
            n = min(len(a), len(b))
            c = float(np.dot(a[:n], b[:n]) / (np.linalg.norm(a[:n]) * np.linalg.norm(b[:n]) + 1e-12))
            if c > 0.98:
                res.warn(spec.name, f"variations {i + 1} and {k + 1} are nearly identical (corr {c:.3f})")


def check_manifest(specs, metrics_by_name: dict, res: Result, full: bool):
    if not os.path.exists(MANIFEST):
        res.fail("manifest", f"{os.path.relpath(MANIFEST, ROOT)} missing")
        return
    with open(MANIFEST, encoding="utf-8") as fh:
        man = json.load(fh)
    if full:
        for extra in sorted(set(man) - set(BY_NAME)):
            res.fail("manifest", f"unknown sound {extra!r}")
    for spec in specs:
        e = man.get(spec.name)
        if e is None:
            res.fail("manifest", f"{spec.name} missing")
            continue
        if set(e.keys()) != {"files", "dur", "loop"}:
            res.fail("manifest", f"{spec.name}: keys {sorted(e.keys())}")
            continue
        if e["files"] != spec.files():
            res.fail("manifest", f"{spec.name}: files {e['files']} != {spec.files()}")
        if e["loop"] is not spec.loop:
            res.fail("manifest", f"{spec.name}: loop flag {e['loop']}")
        ms = metrics_by_name.get(spec.name) or []
        if ms:
            want = round(max(m["samples"] for m in ms) / SR, 3)
            if not isinstance(e["dur"], (int, float)) or abs(e["dur"] - want) > 5e-4:
                res.fail("manifest", f"{spec.name}: dur {e['dur']} != longest file {want}")


# --------------------------------------------------------------------------
# spectrogram contact sheets (ffmpeg showspectrumpic)
# --------------------------------------------------------------------------
TILE_W, SPEC_H, WAVE_H = 320, 192, 48
WINDOWS = [0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 12.8]
FMIN, FMAX = 20.0, SR / 2.0      # showspectrumpic's log axis spans 20 Hz .. Nyquist


def _font() -> str | None:
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
              "/System/Library/Fonts/Menlo.ttc", "C:/Windows/Fonts/consola.ttf"]:
        if os.path.exists(p):
            return p
    return None


def make_tile(job: tuple[str, str, float, float]) -> str | None:
    src, dst, dur, dur_max = job
    win = next((w for w in WINDOWS if w >= dur_max - 1e-6), dur_max)
    # showspectrumpic uses an FFT of 2x the picture height: short sounds get the finer time resolution
    render_h = 256 if win <= 0.4 else 512
    font = _font()
    grid = ""
    for f, lab in [(100.0, "100"), (1000.0, "1k"), (10000.0, "10k")]:
        y = int(round(SPEC_H * (1.0 - math.log(f / FMIN) / math.log(FMAX / FMIN))))
        grid += f",drawbox=x=0:y={y}:w=iw:h=1:color=white@0.22:t=fill"
        if font:
            grid += (f",drawtext=fontfile={font}:text='{lab}':x=w-tw-2:y={y - 10}:fontsize=9:fontcolor=white@0.6")
    label = ""
    if font:
        text = f"{os.path.basename(src)[:-4]}  {dur:.2f}s of {win:g}s"
        label = (f",drawtext=fontfile={font}:text='{text}':x=3:y=3:fontsize=11:fontcolor=white:"
                 f"box=1:boxcolor=black@0.55:boxborderw=2")
    graph = (
        f"[0:a]apad=whole_dur={win},asplit=2[a][b];"
        f"[a]showspectrumpic=s={TILE_W}x{render_h}:legend=0:fscale=log:scale=log:drange=96:color=fiery,"
        f"scale={TILE_W}:{SPEC_H}:flags=area,format=rgb24{grid}{label}[s];"
        f"color=c=0x14141c:s={TILE_W}x{WAVE_H}[bg];"
        f"[b]showwavespic=s={TILE_W}x{WAVE_H}:colors=0x7fd6ff:scale=sqrt,format=rgba[w0];"
        f"[bg][w0]overlay=format=auto,format=rgb24[w];"
        f"[s][w]vstack=inputs=2[out]"
    )
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-filter_complex", graph,
           "-map", "[out]", "-frames:v", "1", dst]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        return f"{os.path.basename(src)}: {p.stderr.strip()[:300]}"
    return None


def make_sheets(specs, metrics_by_name: dict, cols: int = 5, rows: int = 5) -> list[str]:
    """One or more PNG contact sheets per family in SHEET_DIR.  Returns the sheet paths."""
    tiles_dir = os.path.join(SHEET_DIR, "tiles")
    shutil.rmtree(SHEET_DIR, ignore_errors=True)
    os.makedirs(tiles_dir, exist_ok=True)
    families: dict[str, list[tuple[str, float, float]]] = {}
    for spec in specs:
        for m in metrics_by_name.get(spec.name, []):
            families.setdefault(spec.family, []).append((m["file"], m["dur"], spec.dur_max))
    jobs, plan = [], []
    for fam, items in families.items():
        per = cols * rows
        for si in range(0, len(items), per):
            chunk = items[si:si + per]
            sheet = fam if len(items) <= per else f"{fam}_{si // per + 1}"
            for ti, (fname, dur, dur_max) in enumerate(chunk):
                dst = os.path.join(tiles_dir, f"{sheet}_{ti:03d}.png")
                jobs.append((os.path.join(OUT_DIR, fname), dst, dur, dur_max))
            plan.append((sheet, len(chunk), [c[0] for c in chunk]))
    with ThreadPoolExecutor(max_workers=os.cpu_count() or 2) as pool:
        errs = [e for e in pool.map(make_tile, jobs) if e]
    for e in errs:
        print("tile error:", e, file=sys.stderr)
    out = []
    index_lines = []
    for sheet, count, names in plan:
        r = int(math.ceil(count / cols))
        c = min(cols, count)
        dst = os.path.join(SHEET_DIR, f"{sheet}.png")
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-framerate", "1", "-start_number", "0",
               "-i", os.path.join(tiles_dir, f"{sheet}_%03d.png"),
               "-vf", f"tile={c}x{r}:padding=4:margin=4:color=0x30303a", "-frames:v", "1", dst]
        p = subprocess.run(cmd, capture_output=True, text=True)
        if p.returncode != 0:
            print(f"sheet error {sheet}: {p.stderr.strip()[:300]}", file=sys.stderr)
            continue
        out.append(dst)
        index_lines.append(f"{sheet}.png: " + ", ".join(names))
    with open(os.path.join(SHEET_DIR, "index.txt"), "w", encoding="utf-8") as fh:
        fh.write("Each tile: log-frequency spectrogram 20 Hz - 22 kHz (lines at 100 Hz / 1 kHz / 10 kHz), "
                 "96 dB range, waveform strip below.\nTile label: file, duration / time window shown.\n\n")
        fh.write("\n".join(index_lines) + "\n")
    return out


# --------------------------------------------------------------------------
def write_report(all_metrics: list[dict], path: str):
    cols = ["file", "dur", "peak_db", "rms_db", "crest_db", "rms50_db", "onset_ms", "t_peak_ms", "t20_ms", "t40_ms",
            "centroid_hz", "sub", "low", "mid", "high", "air", "on_sub", "on_low", "on_mid", "on_high", "on_air",
            "late_db", "mean", "bytes"]
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\t".join(cols) + "\tlufs\n")
        for m in all_metrics:
            row = []
            for c in cols:
                v = m[c]
                row.append(v if isinstance(v, str) else (f"{v:.4f}" if c == "mean" else f"{v:.3f}" if c == "dur" else f"{v:.1f}"))
            row.append(f"{m['lufs']:.2f}" if "lufs" in m else "")
            fh.write("\t".join(row) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", action="append", default=[], metavar="PREFIX", help="restrict to a name prefix")
    ap.add_argument("--no-sheets", action="store_true", help="skip the spectrogram contact sheets")
    ap.add_argument("--report", action="store_true", help=f"write per-file metrics to {TMP_DIR}/report.tsv")
    ap.add_argument("-v", "--verbose", action="store_true", help="print a line per file")
    args = ap.parse_args()

    prefixes = [p for arg in args.only for p in arg.split(",") if p]
    specs = [s for s in SPECS if not prefixes or any(s.name.startswith(p) for p in prefixes)]
    full = not prefixes
    res = Result()
    os.makedirs(TMP_DIR, exist_ok=True)

    jobs = [(s, f) for s in specs for f in s.files()]
    with ThreadPoolExecutor(max_workers=os.cpu_count() or 2) as pool:
        checked = list(pool.map(lambda j: check_file(j[0], j[1], res), jobs))
    metrics_by_name: dict[str, list[dict]] = {}
    for (spec, _), m in zip(jobs, checked):
        if m is not None:
            metrics_by_name.setdefault(spec.name, []).append(m)
    for spec in specs:
        ms = metrics_by_name.get(spec.name, [])
        if len(ms) > 1:
            check_variations(spec, ms, res)
    check_manifest(specs, metrics_by_name, res, full)

    on_disk = sorted(f for f in os.listdir(OUT_DIR) if not f.startswith(".")) if os.path.isdir(OUT_DIR) else []
    total_bytes = sum(os.path.getsize(os.path.join(OUT_DIR, f)) for f in on_disk)
    if full:
        wanted = {f for s in SPECS for f in s.files()}
        for f in on_disk:
            if f not in wanted:
                res.fail(f, "unexpected file in the sfx folder")
        if total_bytes > SIZE_BUDGET:
            res.fail("size", f"folder is {total_bytes / 1e6:.2f} MB (budget {SIZE_BUDGET / 1e6:.0f} MB)")

    all_metrics = [m for s in specs for m in metrics_by_name.get(s.name, [])]
    if args.verbose:
        for m in all_metrics:
            extra = f" lufs {m['lufs']:6.2f}" if "lufs" in m else f" onset {m['onset_ms']:4.2f}ms"
            print(f"{m['file']:28s} {m['dur']:6.3f}s peak {m['peak_db']:6.2f} dBFS mean {m['mean']:+.4f}{extra}")
    if args.report:
        write_report(all_metrics, os.path.join(TMP_DIR, "report.tsv"))
        print(f"metrics -> {os.path.join(TMP_DIR, 'report.tsv')}")

    sheets = []
    if not args.no_sheets and all_metrics:
        sheets = make_sheets(specs, metrics_by_name)

    n_files = len(all_metrics)
    n_expected = sum(s.variations for s in specs)
    loops = [m for m in all_metrics if m["loop"]]
    shots = [m for m in all_metrics if not m["loop"]]
    print(f"sounds: {len(metrics_by_name)}/{len(specs)}   files: {n_files}/{n_expected}   "
          f"one-shots: {len(shots)}   loops: {len(loops)}   total audio: {sum(m['dur'] for m in all_metrics):.1f} s")
    print(f"folder size: {total_bytes / 1e6:.2f} MB ({len(on_disk)} files; budget {SIZE_BUDGET / 1e6:.0f} MB)")
    if shots:
        pk = [m["peak_db"] for m in shots]
        print(f"one-shot peaks: {min(pk):.2f} .. {max(pk):.2f} dBFS   worst onset: "
              f"{max(m['onset_ms'] for m in shots):.2f} ms   worst |mean|: {max(abs(m['mean']) for m in all_metrics):.4f}")
    for m in loops:
        s = m["seam"]
        print(f"loop {m['file']:24s} {m['dur']:7.3f}s  {m['lufs']:6.2f} LUFS  peak {m['peak_db']:6.2f} dBFS  "
              f"seam step {s['jump']:.4f} (in-loop max {s['step_max']:.4f})  seam HF {s['seam_hf']:.4f} "
              f"(max {s['hf_max']:.4f})  level step {s['level_step_db']:.2f} dB")
    if sheets:
        print(f"contact sheets: {len(sheets)} in {SHEET_DIR}")
    for w in res.warns:
        print("WARN ", w)
    for f in res.fails:
        print("FAIL ", f)
    print(f"RESULT: {'PASS' if not res.fails else 'FAIL'}  ({len(res.fails)} failures, {len(res.warns)} warnings)")
    return 0 if not res.fails else 1


if __name__ == "__main__":
    sys.exit(main())
