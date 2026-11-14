"""DSP building blocks for the voice pipeline (numpy/scipy only, mono float64).

Everything here is deterministic: anything random takes an explicit seed, so
`python3 tools/voice/gen_voice.py` reproduces the same samples every time.
"""
from __future__ import annotations

import math

import numpy as np
from scipy import signal

from vo_measure import SR, loudness, true_peak_db

# ----------------------------------------------------------------------------
# basics
# ----------------------------------------------------------------------------


def db(x: float) -> float:
    """dB -> linear gain."""
    return 10.0 ** (x / 20.0)


def resample(x: np.ndarray, sr_in: int, sr_out: int = SR) -> np.ndarray:
    if sr_in == sr_out:
        return np.asarray(x, dtype=np.float64).copy()
    g = math.gcd(sr_in, sr_out)
    return signal.resample_poly(np.asarray(x, dtype=np.float64), sr_out // g, sr_in // g, window=("kaiser", 9.0))


def remove_dc(x: np.ndarray) -> np.ndarray:
    return x - float(np.mean(x)) if len(x) else x


def highpass(x, f, sr=SR, order=2):
    return signal.sosfilt(signal.butter(order, f, btype="high", fs=sr, output="sos"), x)


def lowpass(x, f, sr=SR, order=2):
    f = min(f, 0.49 * sr)
    return signal.sosfilt(signal.butter(order, f, btype="low", fs=sr, output="sos"), x)


def bandpass(x, lo, hi, sr=SR, order=4):
    """Butterworth high-pass at lo + low-pass at hi, each of `order`."""
    return lowpass(highpass(x, lo, sr, order), hi, sr, order)


def _biquad(b0, b1, b2, a0, a1, a2):
    return np.array([[b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0]])


def peak_eq(x, f0, gain_db, q=1.0, sr=SR):
    """RBJ peaking EQ."""
    if abs(gain_db) < 1e-6:
        return x
    a = 10.0 ** (gain_db / 40.0)
    w0 = 2.0 * math.pi * f0 / sr
    alpha = math.sin(w0) / (2.0 * q)
    c = math.cos(w0)
    sos = _biquad(1 + alpha * a, -2 * c, 1 - alpha * a, 1 + alpha / a, -2 * c, 1 - alpha / a)
    return signal.sosfilt(sos, x)


def shelf(x, f0, gain_db, kind="high", sr=SR, slope=0.7):
    """RBJ low/high shelf."""
    if abs(gain_db) < 1e-6:
        return x
    a = 10.0 ** (gain_db / 40.0)
    w0 = 2.0 * math.pi * f0 / sr
    c, s = math.cos(w0), math.sin(w0)
    alpha = s / 2.0 * math.sqrt((a + 1.0 / a) * (1.0 / slope - 1.0) + 2.0)
    sq = 2.0 * math.sqrt(a) * alpha
    if kind == "high":
        sos = _biquad(a * ((a + 1) + (a - 1) * c + sq), -2 * a * ((a - 1) + (a + 1) * c), a * ((a + 1) + (a - 1) * c - sq),
                      (a + 1) - (a - 1) * c + sq, 2 * ((a - 1) - (a + 1) * c), (a + 1) - (a - 1) * c - sq)
    else:
        sos = _biquad(a * ((a + 1) - (a - 1) * c + sq), 2 * a * ((a - 1) - (a + 1) * c), a * ((a + 1) - (a - 1) * c - sq),
                      (a + 1) + (a - 1) * c + sq, -2 * ((a - 1) + (a + 1) * c), (a + 1) + (a - 1) * c - sq)
    return signal.sosfilt(sos, x)


def active_rms(x: np.ndarray, sr: int = SR, floor_db: float = -45.0) -> float:
    """RMS over the parts of the clip that are 'on' (within floor_db of the loudest 20 ms)."""
    win = max(1, int(0.020 * sr))
    if len(x) < win:
        return float(np.sqrt(np.mean(x * x))) if len(x) else 0.0
    csum = np.concatenate(([0.0], np.cumsum(x * x)))
    starts = np.arange(0, len(x) - win + 1, win // 2)
    ms = (csum[starts + win] - csum[starts]) / win
    top = ms.max()
    if top <= 0:
        return 0.0
    keep = ms > top * 10.0 ** (floor_db / 10.0)
    return float(np.sqrt(ms[keep].mean()))


def set_level(x: np.ndarray, target_db: float = -20.0, sr: int = SR) -> np.ndarray:
    """Scale so the active-speech RMS sits at target_db.

    Every effect chain starts with this, so thresholds and drive amounts mean
    the same thing for every engine (their native levels differ by ~14 dB).
    """
    r = active_rms(x, sr)
    return x * (db(target_db) / r) if r > 0 else x


# ----------------------------------------------------------------------------
# dynamics
# ----------------------------------------------------------------------------


def compress(x, thresh_db=-20.0, ratio=3.0, attack_ms=5.0, release_ms=90.0, knee_db=6.0,
             makeup_db=0.0, sr=SR):
    """Feed-forward soft-knee compressor (peak detector, 1 ms control rate)."""
    blk = max(1, int(sr * 0.001))
    n = len(x)
    nblk = int(math.ceil(n / blk))
    pad = np.zeros(nblk * blk)
    pad[:n] = np.abs(x)
    lev = pad.reshape(nblk, blk).max(axis=1)
    lev_db = 20.0 * np.log10(np.maximum(lev, 1e-9))
    over = lev_db - thresh_db
    slope = 1.0 - 1.0 / ratio
    gr = np.where(over <= -knee_db / 2.0, 0.0,
                  np.where(over >= knee_db / 2.0, -slope * over,
                           -slope * (over + knee_db / 2.0) ** 2 / (2.0 * max(knee_db, 1e-9))))
    a_att = math.exp(-1.0 / max(attack_ms, 1e-3))
    a_rel = math.exp(-1.0 / max(release_ms, 1e-3))
    out = np.empty(nblk)
    s = 0.0
    for k in range(nblk):
        t = gr[k]
        c = a_att if t < s else a_rel
        s = c * s + (1.0 - c) * t
        out[k] = s
    centres = (np.arange(nblk) + 0.5) * blk
    g_db = np.interp(np.arange(n), centres, out)
    return x * 10.0 ** ((g_db + makeup_db) / 20.0)


def saturate(x, drive_db=6.0, asym=0.0, oversample=2, sr=SR):
    """tanh soft clipper, unity gain for small signals.

    asym adds a little even-harmonic (speaker/tube-like) colour; the result is
    DC-blocked. Oversampled so the new harmonics do not alias.
    """
    g = db(drive_db)
    y = signal.resample_poly(x, oversample, 1) if oversample > 1 else x
    y = np.tanh(g * y + asym) - math.tanh(asym)
    y = y / g
    if oversample > 1:
        y = signal.resample_poly(y, 1, oversample)[: len(x)]
    if asym:
        y = highpass(y, 30.0, sr, 1)
    return y


def hard_clip(x, ceiling_db=-6.0, softness=0.15, oversample=4):
    """Hard-ish clipper (cheap amplifier / tiny speaker). softness rounds the corner."""
    c = db(ceiling_db)
    y = signal.resample_poly(x, oversample, 1) if oversample > 1 else x
    lin = c * (1.0 - softness)
    over = np.abs(y) > lin
    yo = np.sign(y[over]) * (lin + (c - lin) * np.tanh((np.abs(y[over]) - lin) / max(c - lin, 1e-9)))
    y = y.copy()
    y[over] = yo
    if oversample > 1:
        y = signal.resample_poly(y, 1, oversample)[: len(x)]
    return y


def limit(x, ceiling_db=-2.0, release_ms=60.0, lookahead_ms=2.0, sr=SR):
    """Look-ahead brick-wall limiter working on the 4x oversampled (true) peak.

    The gain is piecewise linear between 0.5 ms block edges. Each edge may not
    exceed what the loudest true-peak sample of either neighbouring block
    needs; that cap is looked ahead by `lookahead_ms`, released exponentially
    and then averaged over the look-ahead window, which turns every gain drop
    into a smooth ramp that is complete before the peak arrives.
    """
    n = len(x)
    if n == 0:
        return x
    ceil_lin = db(ceiling_db)
    os_ = 4
    up = np.abs(signal.resample_poly(x, os_, 1, window=("kaiser", 12.0)))
    up = up[: n * os_] if len(up) >= n * os_ else np.pad(up, (0, n * os_ - len(up)))
    tp = np.maximum(up.reshape(n, os_).max(axis=1), np.abs(x))
    if tp.max() <= ceil_lin:
        return x
    blk = max(1, int(sr * 0.0005))
    nblk = int(math.ceil(n / blk))
    pad = np.zeros(nblk * blk)
    pad[:n] = tp
    need = np.minimum(1.0, ceil_lin / np.maximum(pad.reshape(nblk, blk).max(axis=1), 1e-12))
    # cap at edge j (between block j-1 and block j)
    cap = np.minimum(np.concatenate(([1.0], need)), np.concatenate((need, [1.0])))
    la = max(1, int(round(lookahead_ms / 0.5)))
    # minimum over [j, j+la]
    cap_la = _lookahead_min(cap, la)
    rel = math.exp(-0.5 / max(release_ms, 1e-3))
    c = np.empty(len(cap_la))
    s = 1.0
    for j in range(len(cap_la)):
        s = 1.0 - (1.0 - s) * rel
        if cap_la[j] < s:
            s = cap_la[j]
        c[j] = s
    # mean over [j-la, j]: every term is <= cap[j], so the result is too
    cpad = np.concatenate((np.full(la, c[0]), c))
    csum = np.concatenate(([0.0], np.cumsum(cpad)))
    g_edge = (csum[la + 1:] - csum[: len(c)]) / (la + 1)
    gain = np.interp(np.arange(n), np.arange(nblk + 1) * blk, g_edge)
    return x * gain


def _lookahead_min(cap: np.ndarray, la: int) -> np.ndarray:
    """min(cap[j : j+la+1]) for every j (vectorised)."""
    padded = np.concatenate((cap, np.full(la, 1.0)))
    win = np.lib.stride_tricks.sliding_window_view(padded, la + 1)
    return win.min(axis=1)


# ----------------------------------------------------------------------------
# time-domain colour
# ----------------------------------------------------------------------------


def delay_mix(x, delay_ms, gain_db, sr=SR, lp=None, taps=1, tap_fall_db=8.0):
    """Add `taps` echoes, each tap_fall_db quieter than the one before. Output is len(x) + tail."""
    d = int(round(delay_ms * 1e-3 * sr))
    out = np.zeros(len(x) + d * taps)
    out[: len(x)] = x
    wet = x if lp is None else lowpass(x, lp, sr, 2)
    for k in range(1, taps + 1):
        out[d * k: d * k + len(x)] += wet * db(gain_db - tap_fall_db * (k - 1))
    return out


def _noise(n: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).standard_normal(n)


def reverb_ir(rt60=0.8, sr=SR, seed=1, lo=250.0, hi=4000.0, predelay_ms=12.0, density_ms=4.0):
    """Synthetic room impulse response: band-limited noise with exponential decay.

    The first `density_ms` are thinned to a few discrete reflections so the
    onset of each word is not smeared (keeps consonants crisp).
    """
    n = int(sr * rt60 * 1.15)
    t = np.arange(n) / sr
    ir = _noise(n, seed) * np.exp(-6.9078 * t / rt60)  # -60 dB at rt60
    # sparse early part
    early = int(sr * density_ms * 1e-3 * 6)
    rng = np.random.default_rng(seed + 7919)
    mask = (rng.random(early) < 0.04).astype(float)
    ir[:early] *= mask * 3.0
    ir = bandpass(ir, lo, hi, sr, 2)
    pre = int(sr * predelay_ms * 1e-3)
    ir = np.concatenate((np.zeros(pre), ir))
    e = math.sqrt(float(np.sum(ir * ir)))
    return ir / e if e > 0 else ir


def reverb(x, wet_db=-14.0, rt60=0.8, sr=SR, seed=1, lo=250.0, hi=4000.0, predelay_ms=12.0):
    """x + wet * (x convolved with a unit-energy synthetic IR). Output includes the tail."""
    ir = reverb_ir(rt60, sr, seed, lo, hi, predelay_ms)
    wet = signal.fftconvolve(x, ir)
    out = wet * db(wet_db)
    out[: len(x)] += x
    return out


def comb_bank(x, delays_ms, feedback=0.6, wet_db=-12.0, sr=SR, damp=3500.0, tail_s=0.5):
    """Parallel feedback combs: the 'inside a steel box' resonance. Output includes the tail."""
    n = len(x) + int(tail_s * sr)
    xin = np.zeros(n)
    xin[: len(x)] = x
    wet = np.zeros(n)
    for d_ms in delays_ms:
        d = max(1, int(round(d_ms * 1e-3 * sr)))
        a = np.zeros(d + 1)
        a[0] = 1.0
        a[d] = -feedback
        wet += signal.lfilter([1.0], a, xin) - xin  # echoes only
    wet /= max(len(delays_ms), 1)
    if damp:
        wet = lowpass(wet, damp, sr, 1)
    return xin + wet * db(wet_db)


def ring_mod(x, freq=60.0, mix=0.35, sr=SR, phase=0.0):
    """Blend of dry and ring-modulated signal: mix=0 dry, mix=1 classic Dalek."""
    t = np.arange(len(x)) / sr
    carrier = np.sin(2.0 * math.pi * freq * t + phase)
    return x * ((1.0 - mix) + mix * carrier)


def tremolo(x, freq=30.0, depth=0.3, sr=SR):
    """Amplitude modulation that never inverts the signal (gentler than ring_mod)."""
    t = np.arange(len(x)) / sr
    return x * (1.0 - depth * 0.5 * (1.0 + np.sin(2.0 * math.pi * freq * t)))


def mod_delay(x, base_ms, depth_ms=0.0, rate_hz=0.0, sr=SR, phase=0.0):
    """x delayed by base_ms + depth_ms*sin(2*pi*rate*t + phase) (linear interpolation)."""
    n = len(x)
    idx = np.arange(n, dtype=np.float64)
    d = (base_ms + depth_ms * np.sin(2.0 * math.pi * rate_hz * idx / sr + phase)) * 1e-3 * sr
    return np.interp(idx - d, idx, x, left=0.0, right=0.0)


def flanger(x, base_ms=2.5, depth_ms=1.0, rate_hz=0.35, mix=0.5, sr=SR, phase=0.0):
    """Feed-forward flanger / swept comb."""
    return x + mix * mod_delay(x, base_ms, depth_ms, rate_hz, sr, phase)


def chorus(x, voices, sr=SR):
    """Doubling: voices = [(delay_ms, depth_ms, rate_hz, gain_db, phase), ...]."""
    out = x.copy()
    for (delay_ms, depth_ms, rate_hz, gain_db, phase) in voices:
        out += db(gain_db) * mod_delay(x, delay_ms, depth_ms, rate_hz, sr, phase)
    return out


def bitcrush(x, bits=10, rate_hz=11025.0, sr=SR):
    """Light lo-fi: anti-aliased decimation to rate_hz, zero-order-hold back up, quantise.

    The hold leaves spectral images above rate_hz/2 (the 'cheap DAC' sheen)
    without folding junk down into the speech band.
    """
    y = x
    if rate_hz and rate_hz < sr:
        g = math.gcd(int(rate_hz), sr)
        down = signal.resample_poly(x, int(rate_hz) // g, sr // g)
        idx = np.minimum((np.arange(len(x)) * (rate_hz / sr)).astype(np.int64), len(down) - 1)
        y = down[idx]
    if bits:
        q = 2.0 ** (bits - 1)
        y = np.round(y * q) / q
    return y


def varispeed(x, factor):
    """Resample so the clip plays `factor` times slower and lower (factor>1 = bigger, deeper)."""
    if abs(factor - 1.0) < 1e-6:
        return x
    num = int(round(1000 * factor))
    g = math.gcd(num, 1000)
    return signal.resample_poly(x, num // g, 1000 // g, window=("kaiser", 9.0))


def power_down(x, start_frac=0.55, end_speed=0.6, sr=SR):
    """Tape-stop: from start_frac onward the playback speed glides down to end_speed."""
    n = len(x)
    s = int(n * start_frac)
    if s >= n - 2:
        return x
    m = n - s
    # read position p(k) advances by speed(k); speed falls linearly in output time
    out_len = int(m * 2.0 / (1.0 + end_speed))
    speed = np.linspace(1.0, end_speed, out_len)
    pos = np.concatenate(([0.0], np.cumsum(speed)[:-1]))
    pos = pos[pos < m - 1]
    tail = np.interp(pos, np.arange(m), x[s:])
    return np.concatenate((x[:s], tail))


# ----------------------------------------------------------------------------
# edges
# ----------------------------------------------------------------------------


def fade(x, in_ms=6.0, out_ms=8.0, sr=SR):
    """Raised-cosine fades; first and last sample become exactly 0."""
    x = x.copy()
    ni = min(int(in_ms * 1e-3 * sr), len(x) // 2)
    no = min(int(out_ms * 1e-3 * sr), len(x) // 2)
    if ni > 1:
        x[:ni] *= 0.5 - 0.5 * np.cos(math.pi * np.arange(ni) / (ni - 1))
    if no > 1:
        x[-no:] *= 0.5 + 0.5 * np.cos(math.pi * np.arange(no) / (no - 1))
    return x


def find_active(x, sr=SR, thresh_db=-50.0, rel=True, win_ms=5.0):
    """(first, last) sample index where the 5 ms RMS envelope exceeds the threshold.

    rel=True: threshold is relative to the loudest window; else absolute dBFS.
    Returns None if nothing exceeds it.
    """
    win = max(1, int(win_ms * 1e-3 * sr))
    hop = max(1, win // 4)
    if len(x) < win:
        return None
    csum = np.concatenate(([0.0], np.cumsum(x * x)))
    starts = np.arange(0, len(x) - win + 1, hop)
    ms = (csum[starts + win] - csum[starts]) / win
    env = 10.0 * np.log10(np.maximum(ms, 1e-16))
    thr = env.max() + thresh_db if rel else thresh_db
    on = np.nonzero(env > thr)[0]
    if len(on) == 0:
        return None
    return int(starts[on[0]]), int(min(len(x), starts[on[-1]] + win))


def trim(x, sr=SR, pad_ms=30.0, thresh_db=-50.0, rel=True):
    """Cut leading/trailing silence, leaving pad_ms of it each side (zero-padding if short)."""
    act = find_active(x, sr, thresh_db, rel)
    if act is None:
        return x
    pad = int(pad_ms * 1e-3 * sr)
    a, b = act
    head = x[max(0, a - pad): a]
    tail = x[b: b + pad]
    if len(head) < pad:
        head = np.concatenate((np.zeros(pad - len(head)), head))
    if len(tail) < pad:
        tail = np.concatenate((tail, np.zeros(pad - len(tail))))
    return np.concatenate((head, x[a:b], tail))


def tidy_edges(x, sr=SR, pad_ms=30.0, floor_db=-60.0, fade_in_ms=5.0, fade_out_ms=8.0, guard_ms=2.0):
    """Final edges: cut at the first/last moment above floor_db (absolute dBFS),
    fade the cut ends, then add pad_ms of true digital silence on both sides.
    """
    act = find_active(x, sr, floor_db, rel=False)
    if act is None:
        return x
    g = int(guard_ms * 1e-3 * sr)
    a, b = max(0, act[0] - g), min(len(x), act[1] + g)
    core = fade(x[a:b], fade_in_ms, fade_out_ms, sr)
    pad = np.zeros(int(round(pad_ms * 1e-3 * sr)))
    return np.concatenate((pad, core, pad))


def concat_with_pauses(chunks, pauses_s, sr=SR):
    """Join pre-trimmed, pre-faded chunks with silences of the given lengths."""
    out = [chunks[0]]
    for c, p in zip(chunks[1:], pauses_s):
        out.append(np.zeros(int(p * sr)))
        out.append(c)
    return np.concatenate(out)


# ----------------------------------------------------------------------------
# loudness normalisation
# ----------------------------------------------------------------------------


def normalize(x, target_lufs=-16.0, ceiling_db=-2.0, sr=SR, tol=0.05, max_iter=8):
    """Gain + true-peak limiting until the clip measures target_lufs (+-tol) under the ceiling.

    Returns (y, info). Limiting lowers loudness a little, so gain is re-trimmed
    until both conditions hold.
    """
    y = x
    info = {}
    for i in range(max_iter):
        m = loudness(y, sr)
        if m["lufs"] <= -100.0:
            break
        diff = target_lufs - m["lufs"]
        if abs(diff) <= tol and true_peak_db(y, sr) <= ceiling_db + 0.02:
            break
        y = limit(y * db(diff), ceiling_db, sr=sr)
    m = loudness(y, sr)
    info.update(lufs=m["lufs"], method=m["method"], tp=true_peak_db(y, sr), iters=i)
    return y, info
