"""Render -> auto-balance -> effects -> loop cut -> master -> OGG.

Nobody can audition this music by ear, so the mixer is deliberately
measurement-driven:

* every Part is rendered dry to its own stem and gain-staged so that its gated
  K-weighted loudness *while playing* equals `part.level` (LU, relative);
* reverb / chorus are linear send effects computed here (fx.py), driven by the
  same CC91 / CC93 values that are written into the MIDI;
* the bus chain (rumble filter, mono low end, gentle glue compressor,
  look-ahead true-peak limiter) is solved iteratively for a LUFS target;
* loops are rendered twice back to back on FluidSynth's 64-sample block grid
  and the second pass is cut out, so release tails wrap around the loop point;
  effects and mastering then run in "periodic" mode so the result is exactly
  one period of an endlessly repeating signal.
"""
from __future__ import annotations

import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import numpy as np
import soundfile as sf
from scipy import fft

from . import SR, dsp, fx
from .seq import BLOCK, Song
from .synth import render_midi

PRE_BLOCKS = 344         # ~0.5 s of silence before the first note (synth setup)
SEAM_XFADE = 882         # 20 ms corrective crossfade (a no-op when passes match)
ENC_ARGS = ["-c:a", "libvorbis", "-q:a", "4", "-ar", str(SR), "-ac", "2"]


@dataclass
class Master:
    target: float                    # integrated loudness target, LUFS
    ceiling: float = -1.6            # limiter ceiling before encoding, dBTP
    comp_ratio: float = 1.6          # glue compressor (1.0 disables)
    comp_thresh_rel: float = -2.0    # threshold relative to mix loudness, dB
    comp_attack: float = 30.0
    comp_release: float = 250.0
    hp: float = 28.0
    side_hp: float = 140.0
    low_shelf: tuple[float, float] | None = None    # (Hz, dB)
    high_shelf: tuple[float, float] | None = None   # (Hz, dB)
    peaks: list[tuple[float, float, float]] = field(default_factory=list)  # (Hz, dB, Q)
    lp: float | None = 16500.0
    clip_knee: float = 0.0           # >0: soft-clip this many dB above the limiter ceiling


def log(msg: str) -> None:
    print(msg, flush=True)


# ------------------------------------------------------------------ render

LOOP_PASSES = 3          # back-to-back repetitions rendered; the last one is kept


def render_parts(song: Song, tmp: str, jobs: int = 4, cache: bool = True,
                 tail_s: float = 1.0, reps: int = LOOP_PASSES) -> tuple[dict, int, int]:
    """Render every part of `song` (dry).

    Returns ({part_name: audio}, start, length); audio[start:start+length] is
    the last repetition of the loop (or the whole one-shot).  For loops the
    rendered length is the nominal loop length rounded to FluidSynth's 64-sample
    block grid, so that every repetition is scheduled -- and therefore rendered
    -- identically; `fit_loop` then maps it onto the exact nominal length.

    Loops are rendered LOOP_PASSES times back to back and the final pass is
    cut out, so every release tail from the end of the loop is already ringing
    at its start.  Two passes are enough for that; the third lets FluidSynth's
    voice allocation settle so that the last two passes can be *verified* to be
    sample-identical (see pass_identity), i.e. the cut is the true steady state.
    """
    os.makedirs(tmp, exist_ok=True)
    if song.loop:
        nominal = song.loop_samples
        loop_blocks = int(round(nominal / BLOCK))
        length = loop_blocks * BLOCK
        start = (PRE_BLOCKS + (reps - 1) * loop_blocks) * BLOCK
        total_blocks = PRE_BLOCKS + reps * loop_blocks + int(np.ceil(tail_s * SR / BLOCK))
    else:
        nominal = None
        loop_blocks = None
        reps = 1
        n = int(round(song.sec(song.total_beats) * SR)) + int(tail_s * SR)
        total_blocks = PRE_BLOCKS + int(np.ceil(n / BLOCK))
        start = PRE_BLOCKS * BLOCK
        length = total_blocks * BLOCK - start
    total = total_blocks * BLOCK
    cache_dir = os.path.join(os.path.dirname(tmp.rstrip("/")), "cache") if cache else None

    def one(part):
        if not part.notes:
            return part.name, None
        mid = os.path.join(tmp, f"{part.name}.mid")
        wav = os.path.join(tmp, f"{part.name}.wav")
        part.write_midi(mid, reps=reps, pre_blocks=PRE_BLOCKS, loop_nominal=nominal,
                        loop_blocks=loop_blocks, total_blocks=total_blocks)
        x = render_midi(mid, wav, cache_dir=cache_dir, min_samples=total)
        return part.name, x[:total].astype(np.float64)

    with ThreadPoolExecutor(max_workers=jobs) as ex:
        out = dict(ex.map(one, song.parts))
    return out, start, length


def pass_identity(audio: dict, start: int, length: int, skip_s: float = 0.0) -> float:
    """How identical are the last two rendered passes of a loop?  Returns the
    worst difference over all parts in dB relative to the part's peak;
    -300 means bit-identical."""
    worst = -300.0
    k = int(skip_s * SR)
    if length <= k + SR:
        return worst
    for x in audio.values():
        if x is None:
            continue
        a = x[start - length + k:start]
        b = x[start + k:start + length]
        pk = np.abs(b).max()
        if pk <= 0:
            continue
        d = np.abs(a - b).max()
        worst = max(worst, dsp.db(d / pk) if d > 0 else -300.0)
    return worst


def cut_loop(full: np.ndarray, start: int, length: int) -> tuple[np.ndarray, float]:
    """Cut the last repetition out of a multi-pass render.

    Safety net: the final SEAM_XFADE samples are crossfaded into the audio that
    precedes the loop start in the render (the end of the previous pass), which
    makes the wrap from the last sample to the first exactly the continuous
    render x[start-1] -> x[start].  With block-aligned scheduling both passes
    are sample-identical there and this is a mathematical no-op; it only does
    work if a different FluidSynth build schedules events differently.
    Returns (loop, mismatch_db between the two passes over the crossfade).
    """
    loop = full[start:start + length].copy()
    n = SEAM_XFADE
    pre = full[start - n:start]
    tail = loop[-n:]
    num = np.sqrt(((tail - pre) ** 2).mean())
    den = np.sqrt((pre ** 2).mean()) + 1e-12
    if num > 0:
        w = 0.5 - 0.5 * np.cos(np.pi * (np.arange(n) + 0.5) / n)
        loop[-n:] = tail * (1.0 - w)[:, None] + pre * w[:, None]
    return loop, (dsp.db(num / den) if num > 0 else -300.0)


def fit_loop(loop: np.ndarray, n_out: int) -> np.ndarray:
    """Map a loop rendered on the 64-sample block grid onto exactly `n_out`
    samples by band-limited *periodic* resampling (FFT zero-padding/truncation).

    The length changes by at most 32 samples in several million (< 0.002 %,
    i.e. a pitch/tempo change below 0.03 cent), and because the interpolation
    treats the buffer as one period of a periodic signal it preserves the
    seamless wrap exactly.
    """
    n_in = len(loop)
    if n_in == n_out:
        return loop.copy()
    spec = fft.rfft(loop, axis=0)
    bins_out = n_out // 2 + 1
    out_spec = np.zeros((bins_out, loop.shape[1]), dtype=spec.dtype)
    k = min(bins_out, spec.shape[0])
    out_spec[:k] = spec[:k]
    return fft.irfft(out_spec, n=n_out, axis=0) * (n_out / n_in)


# ---------------------------------------------------------------- assemble

def assemble(song: Song, audio: dict, start: int, length: int) -> tuple[dict, list, float]:
    """Per-part processing, auto gain, chorus and reverb sends.

    Returns ({stem: audio of `length` samples}, table rows, worst seam mismatch).
    """
    loop = song.loop
    dry: dict[str, np.ndarray] = {}
    sends: dict[tuple[str, str], np.ndarray] = {}
    rows = []
    worst = -300.0
    for part in song.parts:
        x = audio.get(part.name)
        if x is None:
            log(f"  ! part {part.name} has no notes")
            continue
        if loop:
            seg, mism = cut_loop(x, start, length)
            worst = max(worst, mism)
        else:
            seg = x[start:start + length].copy()

        def insert(sig, part=part):
            if part.hp:
                sig = dsp.highpass(sig, part.hp, 2)
            if part.lp:
                sig = dsp.lowpass(sig, part.lp, 2)
            return sig

        if part.hp or part.lp:
            seg = dsp.periodic(insert, seg) if loop else insert(seg)
        if part.width is not None:
            seg = dsp.stereo_width(seg, part.width)
        if part.clip_db:
            pk = np.abs(seg).max()
            seg = dsp.soft_clip(seg, dsp.db(pk) - part.clip_db, knee_db=max(3.0, part.clip_db))
        if part.cho:
            seg = fx.chorus(seg, part.cho / 127.0, periodic=loop)
        loud = dsp.lufs(seg, periodic=loop)
        if loud < -90:
            log(f"  ! part {part.name} rendered silent")
            continue
        gain = part.level + part.gain - loud
        y = seg * dsp.lin(gain)
        dry[part.stem] = y if part.stem not in dry else dry[part.stem] + y
        sg = fx.send_gain(part.rev)
        if sg > 0:
            key = (part.stem, part.space)
            sends[key] = y * sg if key not in sends else sends[key] + y * sg
        rows.append(dict(name=part.name, stem=part.stem, level=part.level + part.gain,
                         raw_lufs=loud, gain=gain, peak=dsp.sample_peak_db(y),
                         notes=len(part.notes), rev=part.rev, cho=part.cho, space=part.space))
    stems = {}
    for stem, y in dry.items():
        out = y.copy()
        for (st, space), bus in sends.items():
            if st == stem:
                out += fx.reverb(bus, space, periodic=loop)
        stems[stem] = out
    return stems, rows, worst


# ------------------------------------------------------------------ master

def bus_linear(x: np.ndarray, m: Master, loop: bool) -> np.ndarray:
    def chain(sig):
        y = dsp.highpass(sig, m.hp, 2) if m.hp else sig
        if m.side_hp:
            y = dsp.mono_bass(y, m.side_hp)
        if m.low_shelf:
            y = dsp.shelf(y, m.low_shelf[0], m.low_shelf[1], high=False)
        if m.high_shelf:
            y = dsp.shelf(y, m.high_shelf[0], m.high_shelf[1], high=True)
        for fc, g, q in m.peaks:
            y = dsp.peaking(y, fc, g, q)
        if m.lp:
            y = dsp.lowpass(y, m.lp, 4)
        return y
    return dsp.periodic(chain, x) if loop else chain(x)


def _limit(x: np.ndarray, m: Master, ceiling: float, loop: bool):
    def chain(sig):
        if m.clip_knee > 0:
            sig = dsp.soft_clip(sig, ceiling + m.clip_knee, knee_db=2 * m.clip_knee)
        return dsp.limit(sig, ceiling_db=ceiling)
    return dsp.periodic(chain, x) if loop else chain(x)


def master(x: np.ndarray, m: Master, loop: bool, ceiling: float | None = None) -> tuple[np.ndarray, dict]:
    """Bus chain solved for the loudness target.  Returns (audio, stats)."""
    ceiling = m.ceiling if ceiling is None else ceiling
    x = bus_linear(x, m, loop)
    stats = {}
    l0 = dsp.lufs(x, periodic=loop)
    if m.comp_ratio > 1.0:
        kw = dict(thresh_db=l0 + m.comp_thresh_rel, ratio=m.comp_ratio,
                  att_ms=m.comp_attack, rel_ms=m.comp_release)
        if loop:
            x, gr = dsp.periodic(dsp.compress, x, **kw)
        else:
            x, gr = dsp.compress(x, **kw)
        stats["comp_gr_mean"] = float(gr.mean())
        stats["comp_gr_max"] = float(gr.max())
    stats["plr_in"] = dsp.true_peak_db(x, periodic=loop) - dsp.lufs(x, periodic=loop)
    # solve make-up gain so that the limited result hits the target
    g = m.target - dsp.lufs(x, periodic=loop)
    y, gr = x, np.zeros(len(x))
    for _ in range(6):
        y, gr = _limit(x * dsp.lin(g), m, ceiling, loop)
        err = m.target - dsp.lufs(y, periodic=loop)
        if abs(err) < 0.03:
            break
        g += err
    stats.update(
        gain_db=float(g),
        lim_gr_max=float(gr.max()),
        lim_active_pct=float((gr > 0.1).mean() * 100.0),
        lufs=dsp.lufs(y, periodic=loop),
        true_peak=dsp.true_peak_db(y, periodic=loop),
    )
    return y, stats


def solve_gain(bed: np.ndarray, add: np.ndarray, target: float, loop: bool = True) -> float:
    """Gain (dB) for `add` so that bed + gain*add measures `target` LUFS."""
    lo, hi = -40.0, 30.0
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if dsp.lufs(bed + add * dsp.lin(mid), periodic=loop) < target:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


# ------------------------------------------------------------------ encode

def write_wav(path: str, x: np.ndarray) -> None:
    sf.write(path, x.astype(np.float32), SR, subtype="FLOAT")


def encode_ogg(wav: str, ogg: str) -> None:
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", wav,
           "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
           *ENC_ARGS, ogg]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg encode failed: {res.stderr}")


def decode_ogg(ogg: str) -> np.ndarray:
    """Decode with ffmpeg to float64 (n, 2)."""
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", ogg,
           "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "2", "-ar", str(SR), "-"]
    res = subprocess.run(cmd, capture_output=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg decode failed: {res.stderr.decode()[:500]}")
    return np.frombuffer(res.stdout, dtype="<f4").reshape(-1, 2).astype(np.float64)


def encode_checked(x: np.ndarray, tmp: str, out_path: str, name: str) -> tuple[np.ndarray, float]:
    """Encode to OGG, decode again; returns (decoded audio, decoded true peak)."""
    wav = os.path.join(tmp, f"{name}.master.wav")
    write_wav(wav, x)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    encode_ogg(wav, out_path)
    dec = decode_ogg(out_path)
    return dec, dsp.true_peak_db(dec)


# ------------------------------------------------------------ fades (stings)

def trim_sting(x: np.ndarray, seconds: float, fade_out: float = 0.35,
               lead_ms: float = 4.0) -> tuple[np.ndarray, dict]:
    """Trim a one-shot: start just before the first audible sample, cut at
    `seconds` and fade the natural tail to digital silence."""
    a = np.abs(x).max(axis=1)
    thr = a.max() * dsp.lin(-55.0)
    first = int(np.argmax(a > thr))
    s0 = max(0, first - int(lead_ms * 0.001 * SR))
    n = int(round(seconds * SR))
    y = x[s0:s0 + n].copy()
    if len(y) < n:
        y = np.vstack([y, np.zeros((n - len(y), 2))])
    fi = int(0.002 * SR)
    y[:fi] *= (0.5 - 0.5 * np.cos(np.pi * np.arange(fi) / fi))[:, None]
    fo = int(fade_out * SR)
    win = y[-fo:-fo + int(0.05 * SR)]
    tail_rel = dsp.db(np.sqrt((win ** 2).mean()) + 1e-12) - dsp.db(a.max())
    y[-fo:] *= (0.5 + 0.5 * np.cos(np.pi * (np.arange(fo) + 1) / fo))[:, None]
    return y, {"lead_trim": s0, "tail_rel_db": tail_rel}
