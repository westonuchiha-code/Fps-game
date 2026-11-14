"""Character effect chains.

Each chain takes the dry, trimmed 44.1 kHz voice and returns the processed
voice (possibly longer: echo / reverb tails). All parameters come from the
casting table (vo_cast.py); the defaults below are the values that the
intelligibility comparison (intel_check.py) settled on.

    tone()    corrective EQ toward the long-term average speech spectrum
    near      close voice: high-pass + light compression
    radio     two-way radio: band-pass, saturation, compression, noise, squelch
    pa        horn loudspeaker: band-limit, resonances, slapback, short reverb
    price     the uploaded CEO: doubled voice through the PA
    robot     ring-mod / comb / bit-crush / band-pass, per robot type
"""
from __future__ import annotations

import math
import zlib

import numpy as np
from scipy import signal

import vo_dsp as D
from vo_measure import SR

# ----------------------------------------------------------------------------
# tone conditioning
# ----------------------------------------------------------------------------

EQ_BANDS = [100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300]

# Long-term average speech spectrum, 1/3-octave band levels in dB (combined
# male + female, normal vocal effort): Byrne et al., "An international
# comparison of long-term average speech spectra", JASA 96 (4), 1994.
LTASS = dict(zip(EQ_BANDS, [54.4, 57.7, 56.8, 60.2, 60.3, 59.0, 62.1, 62.1, 60.5, 56.8, 53.7, 53.0, 52.0,
                            48.7, 48.1, 46.8, 45.6, 44.5, 44.3]))


def third_octave_levels(x: np.ndarray, sr: int = SR) -> np.ndarray:
    """Band levels (dB, arbitrary reference) in EQ_BANDS from a Welch spectrum."""
    f, p = signal.welch(x, sr, nperseg=4096 if sr > 30000 else 2048)
    out = []
    for c in EQ_BANDS:
        lo, hi = c / 2 ** (1 / 6), c * 2 ** (1 / 6)
        m = (f >= lo) & (f < hi)
        out.append(max(float(p[m].sum()), 1e-20))
    return 10.0 * np.log10(np.array(out))


def tone(x: np.ndarray, curve: dict | None, sr: int = SR) -> np.ndarray:
    """Apply a smooth zero-phase EQ given as {centre_hz: gain_db} on EQ_BANDS."""
    if not curve:
        return x
    freqs = sorted(float(k) for k in curve)
    gains = [float(curve[int(f)] if int(f) in curve else curve[f]) for f in freqs]
    # hold the end values to DC / Nyquist
    fgrid = [0.0] + freqs + [sr / 2.0]
    ggrid = [gains[0]] + gains + [gains[-1]]
    # interpolate in log-frequency on a dense grid for firwin2
    dense = np.linspace(0.0, sr / 2.0, 1025)
    lf = np.log10(np.maximum(dense, 20.0))
    g = np.interp(lf, np.log10(np.maximum(np.array(fgrid), 20.0)), ggrid)
    taps = signal.firwin2(2047, dense, 10.0 ** (g / 20.0), fs=sr)
    return signal.fftconvolve(x, taps, mode="same")


# ----------------------------------------------------------------------------
# chains
# ----------------------------------------------------------------------------


def _seed(key: str, salt: int = 0) -> int:
    return (zlib.crc32(key.encode("utf-8")) + salt * 7919) & 0x7FFFFFFF


def fx_near(x, p, key):
    """Close, natural voice: rumble filter and gentle levelling only."""
    x = D.set_level(x, -20.0)
    x = D.highpass(x, p.get("hp", 85.0), order=2)
    if p.get("effort_db"):  # shouted lines: flatter spectral tilt = more vocal effort
        x = D.shelf(x, 1100.0, p["effort_db"], "high", slope=0.5)
    x = D.compress(x, thresh_db=p.get("thresh", -17.0), ratio=p.get("ratio", 2.5),
                   attack_ms=8.0, release_ms=120.0, knee_db=8.0)
    return x


def fx_radio(x, p, key):
    """Hand-held two-way radio."""
    lo, hi = p.get("lo", 300.0), p.get("hi", 3400.0)
    x = D.set_level(x, -20.0)
    x = D.highpass(x, lo, order=2)
    x = D.peak_eq(x, p.get("honk_hz", 1900.0), p.get("honk_db", 4.0), q=0.9)
    x = D.compress(x, thresh_db=-26.0, ratio=p.get("ratio", 4.0), attack_ms=2.0, release_ms=70.0,
                   knee_db=6.0, makeup_db=6.0)
    x = D.saturate(x, drive_db=p.get("drive", 8.0), asym=0.08)
    x = D.bandpass(x, lo, hi, order=4)
    x = D.set_level(x, -20.0)
    speech = D.db(-20.0)

    # transmission: key-up click, noise bed while keyed, squelch tail at key-down
    lead = int(0.008 * SR)  # keeps the key-up transient clear of the file's fade-in
    pre = int(p.get("pre_ms", 45.0) * 1e-3 * SR)
    tail = int(p.get("tail_ms", 110.0) * 1e-3 * SR)
    start = lead + pre
    n = start + len(x) + tail
    out = np.zeros(n)
    out[start: start + len(x)] = x
    rng = np.random.default_rng(_seed(key))
    hiss = D.bandpass(rng.standard_normal(n + SR // 10), lo, hi, order=2)[SR // 10:]
    hiss /= max(float(np.sqrt(np.mean(hiss * hiss))), 1e-9)
    t = (np.arange(n) - lead) / SR
    on = t >= 0.0
    tp = np.maximum(t, 0.0)
    bed = D.db(p.get("noise_db", -32.0))
    # key-up: carrier appears within ~1 ms, a short burst settles into the bed
    burst = D.db(p.get("click_db", -9.0)) * np.exp(-tp / 0.007)
    # key-down: open-squelch noise that is chopped off
    t_end = t - (pre + len(x)) / SR
    squelch = np.where(t_end >= 0.0, D.db(p.get("squelch_db", -7.0)) * np.exp(-np.maximum(t_end, 0.0) / 0.028), 0.0)
    env = np.where(on, (bed + burst + squelch) * (1.0 - np.exp(-tp / 0.0012)), 0.0)
    out += speech * env * hiss
    # mechanical click of the push-to-talk at both ends (very short damped sine)
    for pos, lvl in ((lead + int(0.002 * SR), -14.0), (start + len(x) + int(0.004 * SR), -16.0)):
        m = int(0.006 * SR)
        tt = np.arange(m) / SR
        click = np.sin(2 * math.pi * 1300.0 * tt) * np.exp(-tt / 0.0012)
        k = max(0, min(m, n - pos))
        out[pos: pos + k] += speech * D.db(lvl) * 3.0 * click[:k]
    return out


def fx_pa(x, p, key):
    """Re-entrant horn loudspeaker on a warehouse wall."""
    lo, hi = p.get("lo", 380.0), p.get("hi", 4300.0)
    x = D.set_level(x, -20.0)
    x = D.highpass(x, lo, order=3)
    x = D.peak_eq(x, p.get("res1_hz", 1250.0), p.get("res1_db", 5.0), q=1.5)
    x = D.peak_eq(x, p.get("res2_hz", 2700.0), p.get("res2_db", 3.5), q=2.2)
    x = D.compress(x, thresh_db=-24.0, ratio=4.0, attack_ms=3.0, release_ms=100.0, knee_db=6.0, makeup_db=5.0)
    x = D.saturate(x, drive_db=p.get("drive", 6.0), asym=0.12)
    x = D.lowpass(x, hi, order=4)
    x = D.set_level(x, -20.0)
    x = D.delay_mix(x, p.get("slap_ms", 105.0), p.get("slap_db", -10.0), lp=p.get("slap_lp", 2600.0),
                    taps=p.get("slap_taps", 2), tap_fall_db=9.0)
    x = D.reverb(x, wet_db=p.get("wet_db", -13.0), rt60=p.get("rt60", 0.9), seed=p.get("room_seed", 404),
                 lo=lo, hi=min(hi, 3200.0), predelay_ms=p.get("predelay_ms", 28.0))
    return x


def fx_price(x, p, key):
    """Max Price: a doubled, slightly too-large voice over the building PA."""
    x = D.varispeed(x, p.get("size", 1.05))
    x = D.set_level(x, -20.0)
    x = D.highpass(x, p.get("lo", 120.0), order=2)
    # doubling: two slowly drifting copies a few cents either side of the original
    x = D.chorus(x, p.get("voices", [(17.0, 0.9, 0.31, -7.0, 0.0), (26.0, 1.3, 0.23, -9.0, 2.1)]))
    if p.get("metal_db") is not None:  # faint fixed comb: the 'speaking from inside a server' edge
        x = x + D.db(p["metal_db"]) * D.mod_delay(x, p.get("metal_ms", 3.7))
    x = D.set_level(x, -20.0)
    x = D.compress(x, thresh_db=-22.0, ratio=3.0, attack_ms=5.0, release_ms=120.0, knee_db=6.0, makeup_db=3.0)
    x = D.peak_eq(x, 1400.0, p.get("horn_db", 2.5), q=1.2)
    x = D.lowpass(x, p.get("hi", 6000.0), order=3)
    x = D.set_level(x, -20.0)
    x = D.delay_mix(x, p.get("slap_ms", 120.0), p.get("slap_db", -12.0), lp=3000.0, taps=2, tap_fall_db=8.0)
    x = D.reverb(x, wet_db=p.get("wet_db", -12.0), rt60=p.get("rt60", 1.2), seed=p.get("room_seed", 404),
                 lo=200.0, hi=3800.0, predelay_ms=p.get("predelay_ms", 38.0))
    return x


def fx_robot(x, p, key):
    """Service-robot voice box. Every stage is optional and driven by the casting table."""
    if p.get("size") and abs(p["size"] - 1.0) > 1e-6:
        x = D.varispeed(x, p["size"])
    x = D.set_level(x, -20.0)
    x = D.highpass(x, p.get("lo", 200.0), order=2)
    sub = p.get("_sub")  # sub-octave double (already time-aligned), see gen_voice
    if sub is not None:
        if p.get("size") and abs(p["size"] - 1.0) > 1e-6:
            sub = D.varispeed(sub, p["size"])
        sub = D.lowpass(D.highpass(sub, 45.0, order=2), p.get("sub_lp", 900.0), order=2)
        m = min(len(sub), len(x))
        r = D.active_rms(sub[:m])
        if r > 0:
            x = x.copy()
            x[:m] += sub[:m] * (D.db(-20.0 + p.get("sub_db", -8.0)) / r)
    if p.get("ring_mix"):
        x = D.ring_mod(x, p.get("ring_hz", 60.0), p["ring_mix"])
    if p.get("flange_mix"):
        x = D.flanger(x, p.get("flange_ms", 2.4), p.get("flange_depth_ms", 0.9), p.get("flange_hz", 0.4),
                      p["flange_mix"], phase=(_seed(key) % 628) / 100.0)
    if p.get("comb_mix"):
        x = x + p["comb_mix"] * D.mod_delay(x, p.get("comb_ms", 5.0))
    x = D.set_level(x, -20.0)
    x = D.compress(x, thresh_db=-22.0, ratio=p.get("ratio", 3.0), attack_ms=3.0, release_ms=80.0,
                   knee_db=6.0, makeup_db=3.0)
    if p.get("drive"):
        x = D.saturate(x, drive_db=p["drive"], asym=p.get("asym", 0.0))
    if p.get("clip_db") is not None:
        x = D.hard_clip(D.set_level(x, -20.0), ceiling_db=p["clip_db"])
    if p.get("crush_bits") or p.get("crush_hz"):
        x = D.bitcrush(x, p.get("crush_bits", 0), p.get("crush_hz", 0))
    for (f0, g, q) in p.get("peaks", []):
        x = D.peak_eq(x, f0, g, q)
    x = D.bandpass(x, p.get("bp_lo", 250.0), p.get("hi", 5500.0), order=p.get("bp_order", 2))
    x = D.set_level(x, -20.0)
    if p.get("metal_db") is not None:
        x = D.comb_bank(x, p.get("metal_ms", [9.7, 13.3, 17.9, 23.1]), p.get("metal_fb", 0.62),
                        p["metal_db"], damp=p.get("metal_damp", 3200.0), tail_s=p.get("metal_tail", 0.45))
    if p.get("wet_db") is not None:
        x = D.reverb(x, wet_db=p["wet_db"], rt60=p.get("rt60", 0.35), seed=p.get("room_seed", 7),
                     lo=p.get("bp_lo", 250.0), hi=min(p.get("hi", 5500.0), 4000.0), predelay_ms=p.get("predelay_ms", 8.0))
    if p.get("power_down"):
        x = D.power_down(x, p["power_down"].get("start", 0.5), p["power_down"].get("end", 0.62))
    return x


CHAINS = {"near": fx_near, "radio": fx_radio, "pa": fx_pa, "price": fx_price, "robot": fx_robot}


def apply(style: str, x: np.ndarray, params: dict, key: str) -> np.ndarray:
    return CHAINS[style](x, params or {}, key)
