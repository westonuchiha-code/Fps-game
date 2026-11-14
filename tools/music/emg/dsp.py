"""Signal-processing helpers: metering, filters, dynamics, loop-seam tools.

All audio is float64/float32 numpy arrays shaped (n, 2) at 44.1 kHz.
"""
from __future__ import annotations

import numpy as np
from scipy import signal
from scipy.ndimage import minimum_filter1d

from . import SR


def db(x: float) -> float:
    return 20.0 * np.log10(max(float(x), 1e-12))


def lin(d: float) -> float:
    return 10.0 ** (d / 20.0)


# ---------------------------------------------------------------- metering

def _k_weight_sos(fs: int = SR) -> np.ndarray:
    """ITU-R BS.1770 K-weighting as two biquads, derived for any sample rate."""
    # stage 1: high shelf (+4 dB above ~1.7 kHz)
    f0, g, q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    k = np.tan(np.pi * f0 / fs)
    vh = 10.0 ** (g / 20.0)
    vb = vh ** 0.4996667741545416
    a0 = 1.0 + k / q + k * k
    b1 = [(vh + vb * k / q + k * k) / a0, 2.0 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0]
    a1 = [1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0]
    # stage 2: RLB high-pass (~38 Hz)
    f0, q = 38.13547087602444, 0.5003270373238773
    k = np.tan(np.pi * f0 / fs)
    a0 = 1.0 + k / q + k * k
    b2 = [1.0, -2.0, 1.0]
    a2 = [1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0]
    return np.array([b1 + a1, b2 + a2])


_KSOS = _k_weight_sos()


def lufs(x: np.ndarray, periodic: bool = False) -> float:
    """Integrated loudness (BS.1770-4, gated) in LUFS.

    periodic=True measures a loop as it is heard when looping (the filter is
    pre-rolled with the end of the loop and blocks wrap around the seam).
    """
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = x[:, None]
    n = x.shape[0]
    block = int(round(0.4 * SR))
    hop = int(round(0.1 * SR))
    if periodic:
        pre = min(n, SR)
        y = signal.sosfilt(_KSOS, np.vstack([x[-pre:], x, x[:block]]), axis=0)[pre:]
    else:
        if n < block:
            x = np.vstack([x, np.zeros((block - n, x.shape[1]))])
        y = signal.sosfilt(_KSOS, x, axis=0)
    p = (y * y).sum(axis=1)
    c = np.concatenate([[0.0], np.cumsum(p)])
    last = (n - 1) if periodic else (len(p) - block)
    starts = np.arange(0, max(last, 0) + 1, hop)
    z = (c[starts + block] - c[starts]) / block
    if len(z) == 0:
        return -120.0
    with np.errstate(divide="ignore"):
        l = -0.691 + 10.0 * np.log10(np.maximum(z, 1e-20))
    keep = l > -70.0
    if not keep.any():
        return -120.0
    thr = -0.691 + 10.0 * np.log10(z[keep].mean()) - 10.0
    keep2 = keep & (l > thr)
    if not keep2.any():
        return -120.0
    return float(-0.691 + 10.0 * np.log10(z[keep2].mean()))


def sample_peak_db(x: np.ndarray) -> float:
    return db(np.abs(x).max()) if x.size else -120.0


def true_peak_db(x: np.ndarray, periodic: bool = False, os: int = 4) -> float:
    """Inter-sample (true) peak in dBTP via 4x polyphase oversampling."""
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = x[:, None]
    if periodic:
        pad = 256
        x = np.vstack([x[-pad:], x, x[:pad]])
    y = signal.resample_poly(x, os, 1, axis=0)
    return db(max(np.abs(y).max(), np.abs(x).max()))


def band_energy_db(x: np.ndarray, bands) -> list[float]:
    """Energy in each (lo, hi) Hz band relative to the total, in dB (mid signal)."""
    m = np.asarray(x, dtype=np.float64)
    if m.ndim == 2:
        m = m.mean(axis=1)
    f, pxx = signal.welch(m, SR, nperseg=8192, noverlap=4096)
    tot = pxx.sum() + 1e-30
    out = []
    for lo, hi in bands:
        sel = (f >= lo) & (f < hi)
        out.append(10.0 * np.log10(pxx[sel].sum() / tot + 1e-30))
    return out


def spectrum_bands(x: np.ndarray) -> dict[str, float]:
    names = ["sub<50", "bass50-120", "lowmid120-400", "mid400-2k", "pres2k-6k", "air6k-16k"]
    edges = [(20, 50), (50, 120), (120, 400), (400, 2000), (2000, 6000), (6000, 16000)]
    return dict(zip(names, band_energy_db(x, edges)))


# ----------------------------------------------------------------- filters

def highpass(x: np.ndarray, fc: float, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, fc, "highpass", fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def lowpass(x: np.ndarray, fc: float, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, fc, "lowpass", fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def shelf(x: np.ndarray, fc: float, gain_db: float, high: bool = True, q: float = 0.707) -> np.ndarray:
    """RBJ low/high shelf."""
    a = 10.0 ** (gain_db / 40.0)
    w0 = 2 * np.pi * fc / SR
    alpha = np.sin(w0) / (2 * q)
    cw = np.cos(w0)
    sq = 2 * np.sqrt(a) * alpha
    if high:
        b = [a * ((a + 1) + (a - 1) * cw + sq), -2 * a * ((a - 1) + (a + 1) * cw),
             a * ((a + 1) + (a - 1) * cw - sq)]
        den = [(a + 1) - (a - 1) * cw + sq, 2 * ((a - 1) - (a + 1) * cw), (a + 1) - (a - 1) * cw - sq]
    else:
        b = [a * ((a + 1) - (a - 1) * cw + sq), 2 * a * ((a - 1) - (a + 1) * cw),
             a * ((a + 1) - (a - 1) * cw - sq)]
        den = [(a + 1) + (a - 1) * cw + sq, -2 * ((a - 1) + (a + 1) * cw), (a + 1) + (a - 1) * cw - sq]
    return signal.lfilter(np.array(b) / den[0], np.array(den) / den[0], x, axis=0)


def peaking(x: np.ndarray, fc: float, gain_db: float, q: float = 1.0) -> np.ndarray:
    """RBJ peaking EQ."""
    a = 10.0 ** (gain_db / 40.0)
    w0 = 2 * np.pi * fc / SR
    alpha = np.sin(w0) / (2 * q)
    b = np.array([1 + alpha * a, -2 * np.cos(w0), 1 - alpha * a])
    den = np.array([1 + alpha / a, -2 * np.cos(w0), 1 - alpha / a])
    return signal.lfilter(b / den[0], den / den[0], x, axis=0)


def stereo_width(x: np.ndarray, width: float) -> np.ndarray:
    m = (x[:, 0] + x[:, 1]) * 0.5
    s = (x[:, 0] - x[:, 1]) * 0.5 * width
    return np.stack([m + s, m - s], axis=1)


def mono_bass(x: np.ndarray, fc: float = 140.0) -> np.ndarray:
    """Collapse the stereo side signal below fc (keeps the low end mono)."""
    m = (x[:, 0] + x[:, 1]) * 0.5
    s = (x[:, 0] - x[:, 1]) * 0.5
    s = highpass(s, fc, 2)
    return np.stack([m + s, m - s], axis=1)


# ---------------------------------------------------------------- dynamics

def _envelope_follow(level_db: np.ndarray, att_ms: float, rel_ms: float, rate: float) -> np.ndarray:
    """One-pole attack/release smoothing of a (decimated) dB control signal."""
    ca = np.exp(-1.0 / (att_ms * 0.001 * rate))
    cr = np.exp(-1.0 / (rel_ms * 0.001 * rate))
    out = np.empty_like(level_db)
    y = level_db[0]
    for i, v in enumerate(level_db):
        c = ca if v > y else cr
        y = c * y + (1.0 - c) * v
        out[i] = y
    return out


def compress(x: np.ndarray, thresh_db: float, ratio: float = 2.0, att_ms: float = 30.0,
             rel_ms: float = 220.0, knee_db: float = 6.0, hop: int = 32,
             sidechain_hp: float | None = 90.0) -> tuple[np.ndarray, np.ndarray]:
    """Stereo-linked feed-forward RMS compressor.  Returns (y, gain_reduction_db)."""
    x = np.asarray(x, dtype=np.float64)
    sc = highpass(x, sidechain_hp, 1) if sidechain_hp else x
    p = (sc * sc).mean(axis=1)
    nb = len(p) // hop
    if nb < 4:
        return x, np.zeros(len(x))
    pb = p[: nb * hop].reshape(nb, hop).mean(axis=1)
    lvl = 10.0 * np.log10(pb + 1e-12)
    over = lvl - thresh_db
    # soft knee static curve
    gr = np.where(over <= -knee_db / 2, 0.0,
                  np.where(over >= knee_db / 2, over * (1 - 1 / ratio),
                           (1 - 1 / ratio) * (over + knee_db / 2) ** 2 / (2 * knee_db)))
    gr_s = _envelope_follow(gr, att_ms, rel_ms, SR / hop)
    t_blk = (np.arange(nb) + 0.5) * hop
    g_db = -np.interp(np.arange(len(x)), t_blk, gr_s)
    return x * (10.0 ** (g_db / 20.0))[:, None], -g_db


def limit(x: np.ndarray, ceiling_db: float = -1.5, lookahead_ms: float = 4.0,
          release_ms: float = 90.0, hop: int = 8) -> tuple[np.ndarray, np.ndarray]:
    """Transparent look-ahead peak limiter (stereo linked, 4x oversampled
    detector so inter-sample peaks are caught too).

    Returns (y, gain_reduction_db per sample).
    """
    x = np.asarray(x, dtype=np.float64)
    c = lin(ceiling_db)
    os = 4
    up = signal.resample_poly(x, os, 1, axis=0)
    pk = np.abs(up).max(axis=1)
    pk = pk[: len(x) * os].reshape(len(x), os).max(axis=1)
    pk = np.maximum(pk, np.abs(x).max(axis=1))
    if pk.max() <= c:
        return x.copy(), np.zeros(len(x))
    nb = int(np.ceil(len(x) / hop))
    pad = nb * hop - len(x)
    pkb = np.pad(pk, (0, pad)).reshape(nb, hop).max(axis=1)
    req = np.minimum(1.0, c / np.maximum(pkb, 1e-12))
    # release smoothing (decimated rate): gain recovers exponentially
    rate = SR / hop
    cr = np.exp(-1.0 / (release_ms * 0.001 * rate))
    g = np.empty(nb)
    y = 1.0
    for i in range(nb):
        y = cr * y + (1.0 - cr) * 1.0
        if req[i] < y:
            y = req[i]
        g[i] = y
    # look-ahead: every block sees the minimum of itself and the next `la`
    # blocks, then a causal moving average of length `la` ramps into each
    # reduction.  Every averaged term already includes the current block's
    # requirement, so the smoothed gain can never overshoot the ceiling.
    la = max(2, int(round(lookahead_ms * 0.001 * rate)))
    gp = np.concatenate([g, np.full(la, 1.0)])
    gmin = g.copy()
    for k in range(1, la + 1):
        np.minimum(gmin, gp[k:k + nb], out=gmin)
    ker = np.ones(la) / la
    gs = np.convolve(np.concatenate([np.full(la - 1, gmin[0]), gmin]), ker, mode="valid")
    # sample-rate gain: hold the lower of neighbouring blocks, linear in between
    gs3 = minimum_filter1d(gs, size=3, mode="nearest")
    t_blk = (np.arange(nb) + 0.5) * hop
    gg = np.interp(np.arange(len(x)), t_blk, gs3)
    y = x * gg[:, None]
    # absolute safety net (should be a no-op)
    np.clip(y, -c, c, out=y)
    return y, -20.0 * np.log10(np.maximum(gg, 1e-9))


def soft_clip(x: np.ndarray, ceiling_db: float, knee_db: float = 4.0) -> np.ndarray:
    """Soft saturator: transparent below (ceiling - knee), asymptotic at ceiling.
    Run at 4x oversampling to keep aliasing out of the audio band."""
    c = lin(ceiling_db)
    t = lin(ceiling_db - knee_db)
    up = signal.resample_poly(np.asarray(x, dtype=np.float64), 4, 1, axis=0)
    a = np.abs(up)
    over = a > t
    out = up.copy()
    span = c - t
    out[over] = np.sign(up[over]) * (t + span * np.tanh((a[over] - t) / span))
    return signal.resample_poly(out, 1, 4, axis=0)[: len(x)]


# -------------------------------------------------------------- loop tools

def periodic(fn, x: np.ndarray, *a, pad: int = 2 * SR, **kw):
    """Run a (stateful) processor on a loop so that its output is periodic too.

    The loop is extended with wrapped-around context on both sides (so filters,
    detectors and look-ahead windows are in their steady looping state at the
    seam), processed, and the context is cut off again.
    """
    n = len(x)
    pad = min(pad, n)
    ext = np.concatenate([x[n - pad:], x, x[:pad]], axis=0)
    out = fn(ext, *a, **kw)
    if isinstance(out, tuple):
        return tuple(o[pad: pad + n] for o in out)
    return out[pad: pad + n]


def seam_report(x: np.ndarray, n: int = 64) -> dict:
    """Continuity across the loop point (last n samples joined to first n).

    jump     = largest |x[0] - x[-1]| over channels
    typical  = RMS of sample-to-sample deltas in the n samples either side
    maxlocal = largest sample-to-sample delta in those samples
    A seamless loop has jump of the same order as the local deltas.
    """
    x = np.asarray(x, dtype=np.float64)
    joined = np.vstack([x[-n:], x[:n]])
    d = np.abs(np.diff(joined, axis=0))
    seam = d[n - 1]                         # delta across the join
    local = np.delete(d, n - 1, axis=0)
    typical = float(np.sqrt((local ** 2).mean()))
    maxlocal = float(local.max())
    # second-difference (curvature) test catches slope breaks as well
    dd = np.abs(np.diff(joined, n=2, axis=0))
    seam_dd = float(dd[n - 2: n].max())
    local_dd = np.delete(dd, [n - 2, n - 1], axis=0)
    return {
        "jump": float(seam.max()),
        "typical": typical,
        "maxlocal": maxlocal,
        "ratio_rms": float(seam.max() / max(typical, 1e-9)),
        "ratio_max": float(seam.max() / max(maxlocal, 1e-9)),
        "curv": seam_dd,
        "curv_max_local": float(local_dd.max()),
        "level_db": db(float(np.sqrt((joined ** 2).mean()))),
    }


def clip_runs(x: np.ndarray, thresh: float = 0.999, min_run: int = 3) -> int:
    """Number of runs of >= min_run consecutive samples at/above `thresh`."""
    hot = (np.abs(x) >= thresh).any(axis=1) if x.ndim == 2 else (np.abs(x) >= thresh)
    if not hot.any():
        return 0
    d = np.diff(np.concatenate([[0], hot.astype(np.int8), [0]]))
    starts = np.flatnonzero(d == 1)
    ends = np.flatnonzero(d == -1)
    return int(((ends - starts) >= min_run).sum())


def longest_silence(x: np.ndarray, thresh_db: float = -60.0) -> float:
    """Longest stretch (seconds) where the 20 ms peak stays under thresh_db."""
    a = np.abs(x).max(axis=1) if x.ndim == 2 else np.abs(x)
    w = int(0.02 * SR)
    nb = len(a) // w
    if nb == 0:
        return 0.0
    pk = a[: nb * w].reshape(nb, w).max(axis=1)
    quiet = pk < lin(thresh_db)
    best = cur = 0
    for q in quiet:
        cur = cur + 1 if q else 0
        best = max(best, cur)
    return best * w / SR
