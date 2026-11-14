"""DSP toolkit for the EVERYTHING MUST GO sound-effect generator.

Pure numpy / scipy.  Everything is mono float64 at SR = 44100 Hz.  The helpers
here are deliberately small and composable; the actual sound recipes live in
the ``sounds_*.py`` modules and build every effect out of several layers.
"""
from __future__ import annotations

import math
import zlib
from fractions import Fraction
from functools import lru_cache

import numpy as np
from scipy import signal
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 44100
TAU = 2.0 * math.pi


# --------------------------------------------------------------------------
# basics
# --------------------------------------------------------------------------
def ns(dur: float) -> int:
    """Seconds -> samples (at least 1)."""
    return max(1, int(round(dur * SR)))


def tt(n: int) -> np.ndarray:
    """Time axis in seconds for n samples."""
    return np.arange(n) / SR


def db(x: float) -> float:
    """dB -> linear gain."""
    return 10.0 ** (x / 20.0)


def to_db(x: float) -> float:
    return 20.0 * math.log10(max(float(x), 1e-12))


def peak(x: np.ndarray) -> float:
    return float(np.max(np.abs(x))) if len(x) else 0.0


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x)))) if len(x) else 0.0


def norm(x: np.ndarray, level: float = 1.0) -> np.ndarray:
    p = peak(x)
    return x * (level / p) if p > 1e-12 else x


def seed_for(name: str, variation: int) -> int:
    """Stable per-sound seed (independent of generation order / --only)."""
    return zlib.crc32(f"emg-sfx:{name}:{variation}".encode()) & 0xFFFFFFFF


class Jit:
    """Parameter jitter.  ``j(x)`` -> ``x * U(1 - a, 1 + a)``.

    Variations are made by re-seeding the generator: every noise layer changes
    and every parameter passed through the jitter moves by a few percent.
    """

    def __init__(self, rng: np.random.Generator, amount: float = 0.05):
        self.rng = rng
        self.amount = amount

    def __call__(self, x, amount: float | None = None):
        a = self.amount if amount is None else amount
        return x * (1.0 + self.rng.uniform(-a, a))

    def each(self, xs, amount: float | None = None):
        return [self(x, amount) for x in xs]


def pad(x: np.ndarray, n: int) -> np.ndarray:
    """Trim or zero-pad to exactly n samples."""
    if len(x) >= n:
        return x[:n].copy()
    out = np.zeros(n)
    out[: len(x)] = x
    return out


def _tail_ramp(sig: np.ndarray) -> np.ndarray:
    """Copy of sig whose last few ms are ramped to zero, so that a layer rendered into a
    short buffer never ends on a step (which would click when it is mixed in)."""
    y = np.array(sig, dtype=float, copy=True)
    r = min(ns(0.004), len(y) // 4)
    if r > 1:
        y[-r:] *= 0.5 + 0.5 * np.cos(np.pi * (np.arange(r) + 1) / r)
    return y


def put(buf: np.ndarray, sig: np.ndarray, t: float = 0.0, gain: float = 1.0) -> np.ndarray:
    """Mix ``sig`` into ``buf`` starting at time t (seconds); clips at the end of buf.

    The end of the layer is ramped to zero over <= 4 ms (see _tail_ramp)."""
    sig = _tail_ramp(sig)
    i = int(round(t * SR))
    if i < 0:
        sig = sig[-i:]
        i = 0
    if i >= len(buf):
        return buf
    m = min(len(sig), len(buf) - i)
    buf[i : i + m] += gain * sig[:m]
    return buf


def put_wrap(buf: np.ndarray, sig: np.ndarray, t: float = 0.0, gain: float = 1.0) -> np.ndarray:
    """Mix ``sig`` into ``buf`` circularly (for loops: tails wrap to the start)."""
    sig = _tail_ramp(sig)
    n = len(buf)
    i = int(round(t * SR)) % n
    idx = (i + np.arange(len(sig))) % n
    np.add.at(buf, idx, gain * sig)
    return buf


def mix(n: int, *layers) -> np.ndarray:
    """mix(n, (sig, t, gain), ...) -> buffer of n samples."""
    buf = np.zeros(n)
    for layer in layers:
        sig = layer[0]
        t = layer[1] if len(layer) > 1 else 0.0
        g = layer[2] if len(layer) > 2 else 1.0
        put(buf, sig, t, g)
    return buf


# --------------------------------------------------------------------------
# envelopes
# --------------------------------------------------------------------------
def exp_env(n: int, tau: float) -> np.ndarray:
    return np.exp(-tt(n) / tau)


def ad_env(n: int, attack: float, tau: float) -> np.ndarray:
    """Raised-cosine attack (seconds) followed by exponential decay (time constant tau)."""
    t = tt(n)
    if attack <= 0:
        return np.exp(-t / tau)
    a = np.clip(t / attack, 0.0, 1.0)
    a = 0.5 - 0.5 * np.cos(np.pi * a)
    return a * np.exp(-np.maximum(t - attack, 0.0) / tau)


def points(n: int, pts, kind: str = "lin") -> np.ndarray:
    """Break-point envelope.  pts = [(time_s, value), ...].

    kind: 'lin' linear, 'exp' exponential (log-domain interpolation),
          'cos' smooth (cosine) interpolation between points.
    """
    ts = np.array([p[0] for p in pts], dtype=float) * SR
    vs = np.array([p[1] for p in pts], dtype=float)
    idx = np.arange(n, dtype=float)
    if kind == "exp":
        return np.exp(np.interp(idx, ts, np.log(np.maximum(vs, 1e-9))))
    if kind == "cos":
        seg = np.clip(np.searchsorted(ts, idx, side="right") - 1, 0, len(ts) - 2)
        t0, t1 = ts[seg], ts[seg + 1]
        u = np.clip((idx - t0) / np.maximum(t1 - t0, 1e-9), 0.0, 1.0)
        u = 0.5 - 0.5 * np.cos(np.pi * u)
        return vs[seg] + (vs[seg + 1] - vs[seg]) * u
    return np.interp(idx, ts, vs)


def bell_env(n: int, peak_pos: float = 0.5, rise: float = 2.0, fall: float = 2.0, floor: float = 0.0) -> np.ndarray:
    """Asymmetric swell: sin^rise up to peak_pos (0..1 of the length), cos^fall down to zero.

    `floor` lifts only the start (so a swell is audible from the first millisecond)."""
    u = np.arange(n) / max(n - 1, 1)
    p = min(max(peak_pos, 1e-3), 1 - 1e-3)
    up = floor + (1.0 - floor) * np.sin(0.5 * np.pi * np.clip(u / p, 0, 1)) ** rise
    down = np.cos(0.5 * np.pi * np.clip((u - p) / (1 - p), 0, 1)) ** fall
    return np.where(u < p, up, down)


def fade(x: np.ndarray, fin: float = 0.0, fout: float = 0.0) -> np.ndarray:
    """Raised-cosine fade in / out (seconds).  Returns a copy."""
    y = np.array(x, dtype=float, copy=True)
    n = len(y)
    a = min(ns(fin), n) if fin > 0 else 0
    b = min(ns(fout), n) if fout > 0 else 0
    if a > 1:
        y[:a] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    if b > 1:
        y[n - b :] *= 0.5 + 0.5 * np.cos(np.pi * (np.arange(b) + 1) / b)
    return y


def slow_noise(n: int, rng: np.random.Generator, hz: float, lo: float = 0.0, hi: float = 1.0) -> np.ndarray:
    """Smooth random modulator in [lo, hi] with bandwidth ~hz (for rolling / gusting)."""
    m = max(4, int(math.ceil(n / SR * hz * 2)) + 3)
    knots = rng.uniform(0.0, 1.0, m)
    pos = np.linspace(0, m - 1, n)
    i = np.clip(pos.astype(int), 0, m - 2)
    u = pos - i
    u = 0.5 - 0.5 * np.cos(np.pi * u)
    y = knots[i] + (knots[i + 1] - knots[i]) * u
    return lo + (hi - lo) * y


# --------------------------------------------------------------------------
# oscillators
# --------------------------------------------------------------------------
def phasor(freq, n: int | None = None, phase0: float = 0.0) -> np.ndarray:
    """Phase in cycles.  freq is a scalar (needs n) or a per-sample array in Hz."""
    if np.ndim(freq) == 0:
        return phase0 + float(freq) * np.arange(n) / SR
    f = np.asarray(freq, dtype=float)
    ph = np.empty(len(f))
    ph[0] = 0.0
    np.cumsum(f[:-1], out=ph[1:])
    return phase0 + ph / SR


def sine(freq, n: int | None = None, phase0: float = 0.0) -> np.ndarray:
    return np.sin(TAU * phasor(freq, n, phase0))


def _polyblep(ph: np.ndarray, dt: np.ndarray) -> np.ndarray:
    out = np.zeros_like(ph)
    m = ph < dt
    t = ph[m] / dt[m]
    out[m] = t + t - t * t - 1.0
    m = ph > 1.0 - dt
    t = (ph[m] - 1.0) / dt[m]
    out[m] = t * t + t + t + 1.0
    return out


def _dt(freq, shape) -> np.ndarray:
    return np.broadcast_to(np.maximum(np.abs(np.asarray(freq, dtype=float)) / SR, 1e-9), shape).copy()


def saw(freq, n: int | None = None, phase0: float = 0.0) -> np.ndarray:
    """Band-limited (polyBLEP) sawtooth, -1..1."""
    ph = phasor(freq, n, phase0) % 1.0
    return 2.0 * ph - 1.0 - _polyblep(ph, _dt(freq, ph.shape))


def square(freq, n: int | None = None, pw=0.5, phase0: float = 0.0) -> np.ndarray:
    """Band-limited (polyBLEP) pulse with pulse width pw (scalar or array), DC removed."""
    ph = phasor(freq, n, phase0) % 1.0
    dt = _dt(freq, ph.shape)
    pw_a = np.broadcast_to(np.asarray(pw, dtype=float), ph.shape)
    x = np.where(ph < pw_a, 1.0, -1.0)
    x = x + _polyblep(ph, dt) - _polyblep((ph + 1.0 - pw_a) % 1.0, dt)
    return x - (2.0 * pw_a - 1.0)


def tri(freq, n: int | None = None, phase0: float = 0.0) -> np.ndarray:
    ph = phasor(freq, n, phase0) % 1.0
    return 4.0 * np.abs(ph - 0.5) - 1.0


def harmonics(freq, amps, n: int | None = None, phases=None) -> np.ndarray:
    """Additive harmonic tone, automatically band-limited.  amps[k-1] = level of harmonic k."""
    ph = phasor(freq, n)
    f = np.broadcast_to(np.asarray(freq, dtype=float), ph.shape)
    out = np.zeros_like(ph)
    for k, a in enumerate(amps, 1):
        if a == 0.0:
            continue
        p0 = 0.0 if phases is None else phases[k - 1]
        out += a * np.sin(TAU * (k * ph + p0)) * (k * f < 0.45 * SR)
    return out


def fm(fc, fmod, index, n: int | None = None) -> np.ndarray:
    """Two-operator phase-modulation voice (index in radians, scalar or array)."""
    if n is None:
        n = len(fc) if np.ndim(fc) else len(fmod)
    return np.sin(TAU * phasor(fc, n) + index * np.sin(TAU * phasor(fmod, n)))


def exp_sweep(n: int, f0: float, f1: float, tau: float) -> np.ndarray:
    """Frequency curve f1 + (f0 - f1) * exp(-t / tau)."""
    return f1 + (f0 - f1) * np.exp(-tt(n) / tau)


def log_sweep(n: int, f0: float, f1: float) -> np.ndarray:
    """Frequency curve moving geometrically from f0 to f1 over the whole length."""
    return f0 * (f1 / f0) ** (np.arange(n) / max(n - 1, 1))


# --------------------------------------------------------------------------
# noise
# --------------------------------------------------------------------------
def white(n: int, rng: np.random.Generator) -> np.ndarray:
    return rng.uniform(-1.0, 1.0, n)


def colored(n: int, rng: np.random.Generator, alpha: float) -> np.ndarray:
    """Noise with power spectrum 1/f^alpha (alpha=1 pink, 2 brown), ~unit peak."""
    m = max(n, 16)
    spec = np.fft.rfft(rng.standard_normal(m))
    f = np.fft.rfftfreq(m, 1.0 / SR)
    spec *= np.maximum(f, 20.0) ** (-alpha / 2.0)
    spec[0] = 0.0
    x = np.fft.irfft(spec, m)[:n]
    return x / (np.std(x) * 3.0 + 1e-12)


def pink(n: int, rng: np.random.Generator) -> np.ndarray:
    return colored(n, rng, 1.0)


def brown(n: int, rng: np.random.Generator) -> np.ndarray:
    return colored(n, rng, 2.0)


def dust(n: int, rng: np.random.Generator, rate, power: float = 2.0) -> np.ndarray:
    """Sparse random impulses (Poisson, `rate` per second, scalar or per-sample array)."""
    r = np.broadcast_to(np.asarray(rate, dtype=float), (n,))
    hit = rng.random(n) < r / SR
    amp = rng.uniform(0.15, 1.0, n) ** power * rng.choice([-1.0, 1.0], n)
    return hit * amp


# --------------------------------------------------------------------------
# filters
# --------------------------------------------------------------------------
def _clampf(fc: float) -> float:
    return float(min(max(fc, 8.0), 0.49 * SR))


def _rbj(kind: str, fc: float, q: float = 0.7071, gain_db: float = 0.0):
    fc = _clampf(fc)
    w0 = TAU * fc / SR
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / (2.0 * q)
    A = 10.0 ** (gain_db / 40.0)
    if kind == "lp":
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "hp":
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "bp":  # constant 0 dB peak gain
        b = [alpha, 0.0, -alpha]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "notch":
        b = [1.0, -2 * cw, 1.0]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "peak":
        b = [1 + alpha * A, -2 * cw, 1 - alpha * A]
        a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    elif kind == "loshelf":
        sq = 2 * math.sqrt(A) * alpha
        b = [A * ((A + 1) - (A - 1) * cw + sq), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sq)]
        a = [(A + 1) + (A - 1) * cw + sq, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sq]
    elif kind == "hishelf":
        sq = 2 * math.sqrt(A) * alpha
        b = [A * ((A + 1) + (A - 1) * cw + sq), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sq)]
        a = [(A + 1) - (A - 1) * cw + sq, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sq]
    else:
        raise ValueError(kind)
    b = np.array(b) / a[0]
    a = np.array(a) / a[0]
    return b, a


def bq(x, kind: str, fc: float, q: float = 0.7071, gain_db: float = 0.0) -> np.ndarray:
    b, a = _rbj(kind, fc, q, gain_db)
    return signal.lfilter(b, a, x)


def lp(x, fc, q=0.7071):
    return bq(x, "lp", fc, q)


def hp(x, fc, q=0.7071):
    return bq(x, "hp", fc, q)


def bp(x, fc, q=1.0):
    return bq(x, "bp", fc, q)


def notch(x, fc, q=2.0):
    return bq(x, "notch", fc, q)


def peq(x, fc, q, gain_db):
    return bq(x, "peak", fc, q, gain_db)


def loshelf(x, fc, gain_db, q=0.7071):
    return bq(x, "loshelf", fc, q, gain_db)


def hishelf(x, fc, gain_db, q=0.7071):
    return bq(x, "hishelf", fc, q, gain_db)


def lp1(x, fc):
    """One-pole low-pass."""
    a = math.exp(-TAU * _clampf(fc) / SR)
    return signal.lfilter([1 - a], [1, -a], x)


@lru_cache(maxsize=512)
def _butter(order: int, lo: float, hi: float, btype: str):
    nyq = SR / 2.0
    if btype == "low":
        wn = _clampf(hi) / nyq
    elif btype == "high":
        wn = _clampf(lo) / nyq
    else:
        wn = [_clampf(lo) / nyq, _clampf(hi) / nyq]
    return signal.butter(order, wn, btype=btype, output="sos")


def blp(x, fc, order: int = 4):
    return signal.sosfilt(_butter(order, 0.0, round(float(fc), 3), "low"), x)


def bhp(x, fc, order: int = 4):
    return signal.sosfilt(_butter(order, round(float(fc), 3), 0.0, "high"), x)


def bbp(x, lo, hi, order: int = 2):
    """Butterworth band-pass (order per edge)."""
    return signal.sosfilt(_butter(order, round(float(lo), 3), round(float(hi), 3), "band"), x)


def band(x, lo, hi, order: int = 2):
    """Band-limit with optional edges (None / 0 = open)."""
    if lo and hi:
        return bbp(x, lo, hi, order)
    if lo:
        return bhp(x, lo, order)
    if hi:
        return blp(x, hi, order)
    return np.asarray(x, dtype=float)


def svf(x, fc, q=1.0, mode: str = "bp") -> np.ndarray:
    """Time-varying state-variable filter (Zavalishin TPT form, stable under fast sweeps).

    fc and q may be scalars or per-sample arrays.  mode: lp / bp / hp / notch.
    The band-pass output is normalised to unity gain at resonance.
    """
    n = len(x)
    g = np.tan(np.pi * np.clip(np.broadcast_to(np.asarray(fc, dtype=float), (n,)), 10.0, 0.45 * SR) / SR)
    k = 1.0 / np.broadcast_to(np.asarray(q, dtype=float), (n,))
    a1 = 1.0 / (1.0 + g * (g + k))
    a2 = g * a1
    a3 = g * a2
    xl, a1l, a2l, a3l, kl = np.asarray(x, dtype=float).tolist(), a1.tolist(), a2.tolist(), a3.tolist(), k.tolist()
    out = [0.0] * n
    ic1 = ic2 = 0.0
    if mode == "lp":
        for i in range(n):
            v3 = xl[i] - ic2
            v1 = a1l[i] * ic1 + a2l[i] * v3
            v2 = ic2 + a2l[i] * ic1 + a3l[i] * v3
            ic1 = 2.0 * v1 - ic1
            ic2 = 2.0 * v2 - ic2
            out[i] = v2
    elif mode == "bp":
        for i in range(n):
            v3 = xl[i] - ic2
            v1 = a1l[i] * ic1 + a2l[i] * v3
            v2 = ic2 + a2l[i] * ic1 + a3l[i] * v3
            ic1 = 2.0 * v1 - ic1
            ic2 = 2.0 * v2 - ic2
            out[i] = kl[i] * v1
    elif mode == "hp":
        for i in range(n):
            v3 = xl[i] - ic2
            v1 = a1l[i] * ic1 + a2l[i] * v3
            v2 = ic2 + a2l[i] * ic1 + a3l[i] * v3
            ic1 = 2.0 * v1 - ic1
            ic2 = 2.0 * v2 - ic2
            out[i] = xl[i] - kl[i] * v1 - v2
    elif mode == "notch":
        for i in range(n):
            v3 = xl[i] - ic2
            v1 = a1l[i] * ic1 + a2l[i] * v3
            v2 = ic2 + a2l[i] * ic1 + a3l[i] * v3
            ic1 = 2.0 * v1 - ic1
            ic2 = 2.0 * v2 - ic2
            out[i] = xl[i] - kl[i] * v1
    else:
        raise ValueError(mode)
    return np.array(out)


# --------------------------------------------------------------------------
# resonant / modal synthesis
# --------------------------------------------------------------------------
def modal(n: int, freqs, taus, amps, rng: np.random.Generator | None = None, attack: float = 0.0, detune: float = 0.0) -> np.ndarray:
    """Sum of exponentially decaying sine partials (struck bars, plates, bells, glass)."""
    t = tt(n)
    out = np.zeros(n)
    for f, tau, a in zip(freqs, taus, amps):
        if detune and rng is not None:
            f = f * (1.0 + rng.uniform(-detune, detune))
        if f >= 0.47 * SR:
            continue
        ph = rng.uniform(0, TAU) if rng is not None else 0.0
        out += a * np.exp(-t / tau) * np.sin(TAU * f * t + ph)
    if attack > 0:
        out *= 1.0 - np.exp(-t / attack)
    return out


def resonators(x, freqs, taus, amps) -> np.ndarray:
    """Excite a bank of two-pole resonators with x (excitation-coloured modal sound)."""
    out = np.zeros(len(x))
    for f, tau, a in zip(freqs, taus, amps):
        if f >= 0.47 * SR:
            continue
        r = math.exp(-1.0 / (tau * SR))
        w = TAU * f / SR
        y = signal.lfilter([math.sin(w)], [1.0, -2.0 * r * math.cos(w), r * r], x)
        out += a * y
    return out


# --------------------------------------------------------------------------
# delays / reverb
# --------------------------------------------------------------------------
def delay(x, t: float, n_out: int | None = None) -> np.ndarray:
    d = int(round(t * SR))
    n = len(x) + d if n_out is None else n_out
    out = np.zeros(n)
    m = min(len(x), n - d)
    if m > 0:
        out[d : d + m] = x[:m]
    return out


def taps(x, tap_list, n_out: int | None = None, dry: float = 1.0) -> np.ndarray:
    """Multi-tap delay.  tap_list = [(time_s, gain, lowpass_hz or None), ...]."""
    n = len(x) if n_out is None else n_out
    out = dry * pad(x, n)
    for tap in tap_list:
        t, g = tap[0], tap[1]
        fc = tap[2] if len(tap) > 2 else None
        y = x if not fc else lp(x, fc)
        put(out, y, t, g)
    return out


def comb(x, delay_s: float, fb: float, damp: float | None = None, n_out: int | None = None) -> np.ndarray:
    """Feedback comb (block-recursive).  damp = low-pass (Hz) inside the loop."""
    d = max(1, int(round(delay_s * SR)))
    n = len(x) if n_out is None else n_out
    xin = pad(np.asarray(x, dtype=float), n)
    out = np.zeros(n)
    prev = np.zeros(d)
    zi = np.zeros(1)
    a = math.exp(-TAU * damp / SR) if damp else 0.0
    for s in range(0, n, d):
        e = min(s + d, n)
        fbk = prev[: e - s]
        if damp:
            fbk, zi = signal.lfilter([1 - a], [1, -a], fbk, zi=zi)
        blk = xin[s:e] + fb * fbk
        out[s:e] = blk
        prev = np.zeros(d)
        prev[: e - s] = blk
    return out


def make_ir(rng: np.random.Generator, t60: float = 0.6, pre: float = 0.0, lo: float = 150.0, hi: float = 6000.0,
            hf_ratio: float = 0.45, lf_ratio: float = 1.15, build: float = 0.006) -> np.ndarray:
    """Synthetic room / outdoor tail: band-split decaying noise (highs die first)."""
    n = ns(t60 * 1.2)
    t = tt(n)
    w = rng.standard_normal(n)
    k = 6.908
    split1 = min(max(500.0, lo * 2.0), hi * 0.5)
    split2 = min(max(2200.0, split1 * 2.0), hi * 0.9)
    tail = bbp(w, lo, split1) * np.exp(-k * t / (t60 * lf_ratio))
    tail += bbp(w, split1, split2) * np.exp(-k * t / t60)
    tail += bbp(w, split2, hi) * np.exp(-k * t / (t60 * hf_ratio))
    tail *= 1.0 - np.exp(-t / max(build, 1e-4))
    tail /= math.sqrt(float(np.sum(tail**2)) + 1e-12)
    if pre > 0:
        tail = np.concatenate([np.zeros(ns(pre)), tail])
    return tail


def reverb(x, rng: np.random.Generator, t60: float = 0.6, mix_: float = 0.2, pre: float = 0.008, lo: float = 150.0,
           hi: float = 6000.0, hf_ratio: float = 0.45, lf_ratio: float = 1.15, dry: float = 1.0) -> np.ndarray:
    """Convolution reverb with a synthetic IR.  Output has the same length as x."""
    ir = make_ir(rng, t60, pre, lo, hi, hf_ratio, lf_ratio)
    wet = signal.fftconvolve(x, ir)[: len(x)]
    return dry * np.asarray(x, dtype=float) + mix_ * wet


def smear(x, rng: np.random.Generator, dur: float = 0.03, lo: float = 200.0, hi: float = 4000.0) -> np.ndarray:
    """Diffuse a signal by convolving it with a very short noise burst (distant-echo blur)."""
    n = ns(dur)
    k = band(rng.standard_normal(n + 64), lo, hi)[64:] * np.hanning(n * 2)[n:]
    k /= math.sqrt(float(np.sum(k**2)) + 1e-12)
    return signal.fftconvolve(x, k)[: len(x)]


# --------------------------------------------------------------------------
# dynamics / colour
# --------------------------------------------------------------------------
def softclip(x, drive: float = 1.0) -> np.ndarray:
    """tanh saturation normalised so that an input of 1.0 maps to 1.0."""
    if drive <= 1e-6:
        return np.asarray(x, dtype=float)
    return np.tanh(np.asarray(x) * drive) / math.tanh(drive)


def asym(x, drive: float = 1.5, bias: float = 0.2) -> np.ndarray:
    """Asymmetric (even-harmonic) saturation, DC-corrected."""
    y = np.tanh(drive * (np.asarray(x) + bias)) - math.tanh(drive * bias)
    return y / math.tanh(drive)


def knee_clip(x, ceiling: float, knee: float = 0.7) -> np.ndarray:
    """Memoryless soft limiter: linear below knee*ceiling, tanh-rounded into the ceiling."""
    x = np.asarray(x, dtype=float)
    k = knee * ceiling
    a = np.abs(x)
    over = a > k
    y = x.copy()
    span = ceiling - k
    y[over] = np.sign(x[over]) * (k + span * np.tanh((a[over] - k) / span))
    return y


def limiter(x, ceiling: float = 1.0, win_ms: float = 1.5) -> np.ndarray:
    """Look-ahead brick-wall limiter (min-filter + smoothing; output never exceeds ceiling)."""
    x = np.asarray(x, dtype=float)
    need = np.minimum(1.0, ceiling / np.maximum(np.abs(x), 1e-9))
    w = max(3, int(win_ms * SR / 1000.0) | 1)
    g = uniform_filter1d(minimum_filter1d(need, size=w, mode="nearest"), size=w, mode="nearest")
    return x * g


def lofi(x, sr: float = 32000.0, bits: int = 0, mix_: float = 1.0) -> np.ndarray:
    """PS2 / Dreamcast flavour: band-limit to a lower sample rate, optional bit reduction,
    then linear-interpolate back up (keeps a little imaging grit above the old Nyquist)."""
    x = np.asarray(x, dtype=float)
    fr = Fraction(int(sr), SR).limit_denominator(1000)
    y = signal.resample_poly(x, fr.numerator, fr.denominator)
    if bits:
        q = float(2 ** (bits - 1))
        y = np.round(y * q) / q
    pos = np.arange(len(x)) * (fr.numerator / fr.denominator)
    z = np.interp(pos, np.arange(len(y)), y)
    return mix_ * z + (1.0 - mix_) * x


def crush(x, bits: int = 10) -> np.ndarray:
    q = float(2 ** (bits - 1))
    return np.round(np.asarray(x) * q) / q


def varispeed(x, rate) -> np.ndarray:
    """Play x back with a (possibly time-varying) speed curve; output length = len(rate)."""
    x = np.asarray(x, dtype=float)
    r = np.asarray(rate, dtype=float)
    pos = np.concatenate(([0.0], np.cumsum(r[:-1])))
    return np.interp(pos, np.arange(len(x)), x, right=0.0)


# --------------------------------------------------------------------------
# loudness (ITU-R BS.1770 / EBU R128, mono)
# --------------------------------------------------------------------------
def _k_weight(x):
    # high shelf
    f0, G, Q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    K = math.tan(math.pi * f0 / SR)
    Vh = 10.0 ** (G / 20.0)
    Vb = Vh**0.4996667741545416
    a0 = 1.0 + K / Q + K * K
    b = [(Vh + Vb * K / Q + K * K) / a0, 2.0 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0]
    a = [1.0, 2.0 * (K * K - 1.0) / a0, (1.0 - K / Q + K * K) / a0]
    y = signal.lfilter(b, a, x)
    # RLB high-pass
    f0, Q = 38.13547087602444, 0.5003270373238773
    K = math.tan(math.pi * f0 / SR)
    a0 = 1.0 + K / Q + K * K
    a = [1.0, 2.0 * (K * K - 1.0) / a0, (1.0 - K / Q + K * K) / a0]
    return signal.lfilter([1.0, -2.0, 1.0], a, y)


def lufs(x) -> float:
    """Gated integrated loudness of a mono signal (LUFS)."""
    y = _k_weight(np.asarray(x, dtype=float))
    blk, hop = int(0.4 * SR), int(0.1 * SR)
    if len(y) < blk:
        ms = float(np.mean(y**2))
        return -0.691 + 10.0 * math.log10(ms + 1e-12)
    c = np.concatenate(([0.0], np.cumsum(y**2)))
    starts = np.arange(0, len(y) - blk + 1, hop)
    z = (c[starts + blk] - c[starts]) / blk
    l = -0.691 + 10.0 * np.log10(z + 1e-12)
    keep = l > -70.0
    if not np.any(keep):
        return -70.0
    rel = -0.691 + 10.0 * math.log10(float(np.mean(z[keep]))) - 10.0
    keep &= l > rel
    return -0.691 + 10.0 * math.log10(float(np.mean(z[keep])) + 1e-12)


def loop_lufs(x) -> float:
    """Loudness of a loop as it is heard: measured over several seamless repeats."""
    reps = max(2, int(math.ceil(8.0 * SR / len(x))))
    return lufs(np.tile(x, reps))


# --------------------------------------------------------------------------
# loop helpers
# --------------------------------------------------------------------------
def loop_xfade(x, n_loop: int) -> np.ndarray:
    """Make a seamless loop of n_loop samples from a longer render.

    The overrun x[n_loop:] is equal-power cross-faded into the start of the loop,
    so the last sample flows straight into the first one.  Use for noise-like
    (uncorrelated) material; phase-locked tonal layers should instead be rendered
    with a whole number of cycles per loop and need no cross-fade at all.
    """
    x = np.asarray(x, dtype=float)
    xf = len(x) - n_loop
    if xf <= 0:
        raise ValueError("render must be longer than the loop")
    out = x[:n_loop].copy()
    th = (np.arange(xf) / xf) * (math.pi / 2.0)
    out[:xf] = x[:xf] * np.sin(th) + x[n_loop : n_loop + xf] * np.cos(th)
    return out


def loop_apply(x, fn, reps: int = 3) -> np.ndarray:
    """Run a process (filter, reverb, limiter ...) over a periodic signal and return one
    steady-state period, so the result is still exactly periodic.

    The signal is tiled `reps` times and the second-to-last copy is returned: it has
    reps-2 periods of warm-up before it and one period after it (for look-ahead).
    Use more reps for processes whose memory is longer than one loop."""
    n = len(x)
    return np.asarray(fn(np.tile(x, reps)))[(reps - 2) * n : (reps - 1) * n].copy()


def circ_band_noise(n: int, rng: np.random.Generator, lo: float, hi: float, slope_db_oct: float = 0.0, edge: float = 0.25) -> np.ndarray:
    """Exactly periodic band-limited noise (FFT synthesis with raised-cosine band edges)."""
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1.0 / SR)
    fl = np.maximum(f, 1e-3)
    lo_e, hi_e = lo * (1 - edge), hi * (1 + edge)
    w = np.ones_like(f)
    w[f < lo_e] = 0.0
    m = (f >= lo_e) & (f < lo)
    w[m] = 0.5 - 0.5 * np.cos(np.pi * (f[m] - lo_e) / max(lo - lo_e, 1e-9))
    m = (f > hi) & (f <= hi_e)
    w[m] = 0.5 + 0.5 * np.cos(np.pi * (f[m] - hi) / max(hi_e - hi, 1e-9))
    w[f > hi_e] = 0.0
    if slope_db_oct:
        w *= (fl / max(lo, 20.0)) ** (slope_db_oct / 6.0206)
    spec *= w
    spec[0] = 0.0
    x = np.fft.irfft(spec, n)
    return x / (np.std(x) * 3.0 + 1e-12)


def periodic_lfo(n: int, rng: np.random.Generator, cycles=(1, 2, 3, 5), lo: float = 0.0, hi: float = 1.0) -> np.ndarray:
    """Smooth pseudo-random modulator that is exactly periodic over n samples."""
    u = np.arange(n) / n
    y = np.zeros(n)
    for c in cycles:
        y += rng.uniform(0.5, 1.0) / math.sqrt(c) * np.sin(TAU * (c * u + rng.uniform()))
    y = (y - y.min()) / (y.max() - y.min() + 1e-12)
    return lo + (hi - lo) * y
