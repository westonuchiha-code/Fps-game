"""Measurement helpers for the voice pipeline.

Nobody on the project can listen to the audio, so everything the pipeline
decides (levels, trims, casting, how hard an effect may be pushed) is decided
from numbers produced here:

* ITU-R BS.1770-4 / EBU R128 integrated loudness (K-weighting + gating),
  with an ungated K-weighted fallback for clips too short to gate.
* True peak (4x oversampled).
* F0 (pitch) tracking, band energies, spectral centroid.
* Edge / click / DC diagnostics.

Pure numpy/scipy so results do not depend on the installed sox/ffmpeg build.
"""
from __future__ import annotations

import math

import numpy as np
from scipy import signal

SR = 44100  # project sample rate

# ----------------------------------------------------------------------------
# loudness (BS.1770-4)
# ----------------------------------------------------------------------------


def _k_weight_sos(sr: int) -> np.ndarray:
    """K-weighting pre-filter as two biquads (same derivation as libebur128)."""
    # stage 1: high shelf
    f0, gain_db, q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    k = math.tan(math.pi * f0 / sr)
    vh = 10.0 ** (gain_db / 20.0)
    vb = vh ** 0.4996667741545416
    a0 = 1.0 + k / q + k * k
    b1 = [(vh + vb * k / q + k * k) / a0, 2.0 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0]
    a1 = [1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0]
    # stage 2: high pass
    f0, q = 38.13547087602444, 0.5003270373238773
    k = math.tan(math.pi * f0 / sr)
    a0 = 1.0 + k / q + k * k
    b2 = [1.0, -2.0, 1.0]
    a2 = [1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0]
    return np.array([b1 + a1, b2 + a2], dtype=np.float64)


def k_weight(x: np.ndarray, sr: int = SR) -> np.ndarray:
    return signal.sosfilt(_k_weight_sos(sr), x)


def _ms_to_lufs(ms: float) -> float:
    return -0.691 + 10.0 * math.log10(ms) if ms > 0 else -120.0


def loudness(x: np.ndarray, sr: int = SR) -> dict:
    """Integrated loudness of a mono signal.

    Returns {'lufs', 'method', 'blocks'} where method is

    * 'r128'    - normal gated BS.1770 measurement (400 ms blocks, 100 ms hop,
                  -70 LUFS absolute gate, -10 LU relative gate);
    * 'ungated' - clip shorter than one 400 ms gating block (ebur128 cannot
                  measure it): K-weighted mean square over the active part of
                  the clip (everything above -70 LUFS in 50 ms windows), i.e.
                  an RMS-based fallback on the same K-weighted scale.
    """
    x = np.asarray(x, dtype=np.float64)
    y = k_weight(x, sr)
    block = int(round(0.400 * sr))
    hop = int(round(0.100 * sr))
    if len(y) >= block:
        n = 1 + (len(y) - block) // hop
        csum = np.concatenate(([0.0], np.cumsum(y * y)))
        starts = np.arange(n) * hop
        ms = (csum[starts + block] - csum[starts]) / block
        lk = -0.691 + 10.0 * np.log10(np.maximum(ms, 1e-12))
        keep = lk > -70.0
        if keep.any():
            rel = _ms_to_lufs(float(ms[keep].mean())) - 10.0
            keep2 = keep & (lk > rel)
            if keep2.any():
                return {"lufs": _ms_to_lufs(float(ms[keep2].mean())), "method": "r128", "blocks": int(keep2.sum())}
        return {"lufs": -120.0, "method": "r128", "blocks": 0}
    # too short for a gating block
    win = max(1, int(round(0.050 * sr)))
    if len(y) <= win:
        return {"lufs": _ms_to_lufs(float(np.mean(y * y))) if len(y) else -120.0, "method": "ungated", "blocks": 0}
    hop2 = max(1, win // 2)
    n = 1 + (len(y) - win) // hop2
    csum = np.concatenate(([0.0], np.cumsum(y * y)))
    starts = np.arange(n) * hop2
    ms = (csum[starts + win] - csum[starts]) / win
    active = ms > 10.0 ** ((-70.0 + 0.691) / 10.0)
    if not active.any():
        return {"lufs": -120.0, "method": "ungated", "blocks": 0}
    return {"lufs": _ms_to_lufs(float(ms[active].mean())), "method": "ungated", "blocks": 0}


def true_peak_db(x: np.ndarray, sr: int = SR, oversample: int = 4) -> float:
    """True peak in dBTP (4x oversampling, as in BS.1770 annex 2)."""
    x = np.asarray(x, dtype=np.float64)
    if len(x) == 0:
        return -120.0
    up = signal.resample_poly(x, oversample, 1, window=("kaiser", 12.0))
    pk = max(float(np.max(np.abs(up))), float(np.max(np.abs(x))))
    return 20.0 * math.log10(pk) if pk > 0 else -120.0


def sample_peak_db(x: np.ndarray) -> float:
    pk = float(np.max(np.abs(x))) if len(x) else 0.0
    return 20.0 * math.log10(pk) if pk > 0 else -120.0


def rms_db(x: np.ndarray) -> float:
    if len(x) == 0:
        return -120.0
    r = float(np.sqrt(np.mean(np.square(x, dtype=np.float64))))
    return 20.0 * math.log10(r) if r > 0 else -120.0


# ----------------------------------------------------------------------------
# spectral measures
# ----------------------------------------------------------------------------


def band_energy(x: np.ndarray, sr: int, lo: float, hi: float) -> float:
    """Energy (sum of squared magnitude) between lo and hi Hz."""
    x = np.asarray(x, dtype=np.float64)
    n = int(2 ** math.ceil(math.log2(max(len(x), 2))))
    spec = np.abs(np.fft.rfft(x, n)) ** 2
    freqs = np.fft.rfftfreq(n, 1.0 / sr)
    m = (freqs >= lo) & (freqs < hi)
    return float(spec[m].sum())


def band_fraction(x: np.ndarray, sr: int, lo: float, hi: float) -> float:
    tot = band_energy(x, sr, 0.0, sr / 2.0 + 1.0)
    return band_energy(x, sr, lo, hi) / tot if tot > 0 else 0.0


def spectral_centroid(x: np.ndarray, sr: int) -> float:
    x = np.asarray(x, dtype=np.float64)
    n = int(2 ** math.ceil(math.log2(max(len(x), 2))))
    spec = np.abs(np.fft.rfft(x, n)) ** 2
    freqs = np.fft.rfftfreq(n, 1.0 / sr)
    tot = spec.sum()
    return float((spec * freqs).sum() / tot) if tot > 0 else 0.0


def rolloff(x: np.ndarray, sr: int, frac: float = 0.95) -> float:
    """Frequency below which `frac` of the energy lies."""
    x = np.asarray(x, dtype=np.float64)
    n = int(2 ** math.ceil(math.log2(max(len(x), 2))))
    spec = np.abs(np.fft.rfft(x, n)) ** 2
    freqs = np.fft.rfftfreq(n, 1.0 / sr)
    c = np.cumsum(spec)
    if c[-1] <= 0:
        return 0.0
    return float(freqs[int(np.searchsorted(c, frac * c[-1]))])


def third_octave_profile(x: np.ndarray, sr: int, centres=None) -> dict:
    """Relative level (dB re total) in octave bands - a cheap 'spectrum print'."""
    if centres is None:
        centres = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
    tot = band_energy(x, sr, 0.0, sr / 2.0 + 1.0)
    out = {}
    for c in centres:
        lo, hi = c / math.sqrt(2.0), c * math.sqrt(2.0)
        if lo >= sr / 2.0:
            continue
        e = band_energy(x, sr, lo, min(hi, sr / 2.0))
        out[c] = 10.0 * math.log10(e / tot) if e > 0 and tot > 0 else -120.0
    return out


# ----------------------------------------------------------------------------
# pitch
# ----------------------------------------------------------------------------


def f0_track(x: np.ndarray, sr: int, fmin: float = 45.0, fmax: float = 500.0,
             frame_s: float = 0.064, hop_s: float = 0.010, voicing: float = 0.55) -> np.ndarray:
    """Frame-wise F0 (Hz) by normalised autocorrelation; 0 for unvoiced frames.

    Works on a band-limited (<1 kHz) copy at <=16 kHz so it is cheap and not
    confused by formants or by high-frequency effects.
    """
    x = np.asarray(x, dtype=np.float64)
    if sr > 16000:
        g = math.gcd(16000, sr)
        x = signal.resample_poly(x, 16000 // g, sr // g)
        sr = 16000
    sos = signal.butter(4, [40.0, 1000.0], btype="band", fs=sr, output="sos")
    x = signal.sosfiltfilt(sos, x) if len(x) > 64 else x
    frame = int(frame_s * sr)
    hop = int(hop_s * sr)
    if len(x) < frame:
        return np.zeros(0)
    lag_min = int(sr / fmax)
    lag_max = min(int(sr / fmin), frame - 2)
    peak = float(np.max(np.abs(x))) or 1.0
    out = []
    win = np.hanning(frame)
    # autocorrelation of the window, to un-bias the estimate
    wac = np.correlate(win, win, mode="full")[frame - 1:]
    wac = wac / wac[0]
    for start in range(0, len(x) - frame + 1, hop):
        seg = x[start:start + frame]
        if np.sqrt(np.mean(seg * seg)) < 0.03 * peak:
            out.append(0.0)
            continue
        seg = (seg - seg.mean()) * win
        spec = np.fft.rfft(seg, 2 * frame)
        ac = np.fft.irfft(np.abs(spec) ** 2)[:frame]
        if ac[0] <= 0:
            out.append(0.0)
            continue
        ac = ac / ac[0]
        ac = ac / np.maximum(wac, 1e-3)
        region = ac[lag_min:lag_max + 1]
        if len(region) < 3:
            out.append(0.0)
            continue
        best = float(region.max())
        if best < voicing:
            out.append(0.0)
            continue
        # first strong peak (avoid sub-octave errors): earliest local maximum
        # within 90 % of the global best
        idx = None
        for i in range(1, len(region) - 1):
            if region[i] >= 0.9 * best and region[i] >= region[i - 1] and region[i] >= region[i + 1]:
                idx = i
                break
        if idx is None:
            idx = int(np.argmax(region))
        lag = lag_min + idx
        # parabolic refinement
        if 1 <= lag < frame - 1:
            a, b, c = ac[lag - 1], ac[lag], ac[lag + 1]
            den = a - 2 * b + c
            off = 0.5 * (a - c) / den if abs(den) > 1e-12 else 0.0
        else:
            off = 0.0
        out.append(sr / (lag + off))
    return np.array(out)


def f0_stats(x: np.ndarray, sr: int, **kw) -> dict:
    f = f0_track(x, sr, **kw)
    v = f[f > 0]
    if len(v) == 0:
        return {"median": 0.0, "p10": 0.0, "p90": 0.0, "voiced": 0.0}
    return {
        "median": float(np.median(v)),
        "p10": float(np.percentile(v, 10)),
        "p90": float(np.percentile(v, 90)),
        "voiced": float(len(v) / max(len(f), 1)),
    }


# ----------------------------------------------------------------------------
# envelope / silence / edges
# ----------------------------------------------------------------------------


def envelope_db(x: np.ndarray, sr: int, win_s: float = 0.010, hop_s: float = 0.005) -> tuple[np.ndarray, int]:
    """Short-time RMS envelope in dBFS; returns (env, hop_in_samples)."""
    x = np.asarray(x, dtype=np.float64)
    win = max(1, int(win_s * sr))
    hop = max(1, int(hop_s * sr))
    if len(x) < win:
        return np.array([rms_db(x)]), hop
    csum = np.concatenate(([0.0], np.cumsum(x * x)))
    starts = np.arange(0, len(x) - win + 1, hop)
    ms = (csum[starts + win] - csum[starts]) / win
    return 10.0 * np.log10(np.maximum(ms, 1e-14)), hop


def pauses(x: np.ndarray, sr: int, thresh_db: float = -40.0, min_s: float = 0.12) -> list[tuple[float, float]]:
    """Internal silent stretches (start_s, length_s), threshold relative to the peak envelope."""
    env, hop = envelope_db(x, sr)
    if len(env) == 0:
        return []
    quiet = env < (env.max() + thresh_db)
    out = []
    i = 0
    n = len(quiet)
    while i < n:
        if quiet[i]:
            j = i
            while j < n and quiet[j]:
                j += 1
            if i > 0 and j < n and (j - i) * hop / sr >= min_s:
                out.append((i * hop / sr, (j - i) * hop / sr))
            i = j
        else:
            i += 1
    return out


def edge_report(x: np.ndarray, sr: int = SR) -> dict:
    """Numbers used to prove 'no clicks, no DC, tidy edges'."""
    x = np.asarray(x, dtype=np.float64)
    n1 = max(1, int(0.001 * sr))
    env, hop = envelope_db(x, sr, 0.005, 0.001)
    thr = -50.0  # dBFS: first/last moment the clip is audibly 'on'
    on = np.nonzero(env > thr)[0]
    lead = float(on[0] * hop / sr) if len(on) else float(len(x) / sr)
    trail = float((len(x) - (on[-1] * hop + int(0.005 * sr))) / sr) if len(on) else float(len(x) / sr)
    d = np.abs(np.diff(x)) if len(x) > 1 else np.zeros(1)
    return {
        "dc": float(np.mean(x)) if len(x) else 0.0,
        "first_abs": float(abs(x[0])) if len(x) else 0.0,
        "last_abs": float(abs(x[-1])) if len(x) else 0.0,
        "first_ms_peak": float(np.max(np.abs(x[:n1]))) if len(x) else 0.0,
        "last_ms_peak": float(np.max(np.abs(x[-n1:]))) if len(x) else 0.0,
        "lead_s": lead,
        "trail_s": max(0.0, trail),
        "max_step": float(d.max()),
    }
