"""Layer building blocks shared by the sound recipes.

Every recipe in sounds_*.py is a small mix of these layers: a transient click,
band-limited noise bursts, pitched thumps, modal (struck-object) rings,
friction scrapes, whooshes, electrical crackle, motors, early reflections ...
followed by saturation and limiting in ``master``.
"""
from __future__ import annotations

import math

import numpy as np
from scipy import signal

from dsp import *  # noqa: F401,F403  (small toolkit, intentionally star-imported)

_PRE = 2048  # filter warm-up samples so band-limited noise starts "already running"

# Reference pitches (equal temperament, A4 = 440) for the tonal UI / loot set.
NOTE = {n + str(o): 440.0 * 2 ** ((i - 9) / 12 + (o - 4))
        for o in range(1, 9)
        for i, n in enumerate(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])}


# --------------------------------------------------------------------------
# transients and noise
# --------------------------------------------------------------------------
def click(rng, ms: float = 1.5, hp_fc: float = 2000.0, tau_ms: float = 0.4) -> np.ndarray:
    """1-3 ms broadband transient with a hard leading edge."""
    n = ns(ms / 1000.0 * 3.0)
    x = rng.uniform(-1.0, 1.0, n) * np.exp(-np.arange(n) / (tau_ms / 1000.0 * SR))
    x[0] = 1.0
    if n > 2:
        x[1] = -0.55
    if hp_fc:
        x = hp(x, hp_fc)
    return norm(x)


def burst(n: int, rng, lo, hi, tau: float, attack: float = 0.0, order: int = 2) -> np.ndarray:
    """Band-limited noise burst with exponential decay, peak-normalised."""
    x = band(white(n + _PRE, rng), lo, hi, order)[_PRE:]
    return norm(x * ad_env(n, attack, tau))


def multiband(n: int, rng, bands) -> np.ndarray:
    """Sum of noise bursts.  bands = [(lo, hi, tau, gain[, attack]), ...].

    Giving the high bands shorter decays than the low ones is what makes a blast
    sound like a blast (bright at the onset, darkening as it dies)."""
    out = np.zeros(n)
    for b in bands:
        lo, hi, tau, g = b[:4]
        att = b[4] if len(b) > 4 else 0.0
        out += g * burst(n, rng, lo, hi, tau, att)
    return out


def res_burst(n: int, rng, fc: float, q: float, tau: float, attack: float = 0.0) -> np.ndarray:
    """Noise burst through a resonant band-pass (gives a blast its 'voice')."""
    x = bp(white(n + _PRE, rng), fc, q)[_PRE:]
    return norm(x * ad_env(n, attack, tau))


def thump(n: int, f0: float, f1: float, sweep_tau: float, amp_tau: float, attack: float = 0.0008,
          h2: float = 0.0) -> np.ndarray:
    """Low sine whose pitch drops exponentially f0 -> f1 (kick-drum style body)."""
    ph = phasor(exp_sweep(n, f0, f1, sweep_tau))
    x = np.sin(TAU * ph)
    if h2:
        x = x + h2 * np.sin(2.0 * TAU * ph)
    return x * ad_env(n, attack, amp_tau)


def rumble(n: int, rng, lo, hi, tau: float, attack: float = 0.02, roll_hz: float = 6.0, roll: float = 0.5) -> np.ndarray:
    """Slow decaying noise with a rolling amplitude (distant thunder / tail)."""
    x = band(white(n + _PRE, rng), lo, hi)[_PRE:] * ad_env(n, attack, tau)
    if roll:
        x = x * (1.0 - roll + roll * slow_noise(n, rng, roll_hz))
    return norm(x)


def crackle(n: int, rng, rate=150.0, tau: float = 0.0006, hp_fc: float = 2500.0, env=None) -> np.ndarray:
    """Sparks / debris ticks: Poisson impulses, each a tiny decaying noise grain.

    `env` (0..1) thins the impulses out *and* scales them down, so a dying
    crackle never throws a full-size tick late in its tail."""
    r = rate if env is None else rate * np.asarray(env)
    imp = dust(n, rng, r)
    if env is not None:
        imp = imp * np.asarray(env) ** 0.7
    m = ns(tau * 8.0)
    k = np.exp(-np.arange(m) / (tau * SR)) * rng.uniform(-1.0, 1.0, m)
    k[0] = 1.0
    y = signal.fftconvolve(imp, k)[:n]
    if hp_fc:
        y = bhp(y, hp_fc, 2)
    return norm(y) if peak(y) > 0 else y


def arc(n: int, rng, f: float = 120.0, bright: float = 3000.0, stutter: float = 35.0, jitter: float = 0.06) -> np.ndarray:
    """Electric arc: mains-rate pulse train gating bright noise plus a raspy buzz, stuttering."""
    fj = f * (1.0 + jitter * (slow_noise(n, rng, 40.0) * 2.0 - 1.0))
    gate = lp1(0.5 + 0.5 * np.sign(square(fj, pw=0.3)), 4000.0)
    nz = bhp(white(n, rng), bright * 0.6, 2) * gate
    buzz = bbp(saw(fj) + 0.5 * saw(fj * 2.01), bright * 0.4, bright * 2.5)
    st = lp1((slow_noise(n, rng, stutter) > 0.42).astype(float), 600.0)
    return norm((nz + 0.7 * buzz) * (0.25 + 0.75 * st))


# --------------------------------------------------------------------------
# struck objects
# --------------------------------------------------------------------------
BAR = ((1.0, 1.0), (2.756, 0.4), (5.404, 0.18), (8.933, 0.08))      # free bar (glockenspiel, brass tube)
PLATE = ((1.0, 1.0), (1.59, 0.7), (2.14, 0.55), (2.65, 0.4), (3.16, 0.3), (3.89, 0.22), (4.6, 0.15))
SHELL = ((1.0, 1.0), (1.47, 0.6), (2.09, 0.5), (2.56, 0.3), (3.3, 0.22), (4.1, 0.12))


def ping(n: int, rng, f: float, tau: float, partials=BAR, tau_pow: float = 0.7, detune: float = 0.0,
         random_phase: bool = True) -> np.ndarray:
    """Struck metal / glass: inharmonic partial set, higher partials die faster."""
    freqs = [f * r for r, _ in partials]
    amps = [a for _, a in partials]
    taus = [tau / (r**tau_pow) for r, _ in partials]
    return modal(n, freqs, taus, amps, rng=rng if (random_phase or detune) else None, detune=detune)


def clack(rng, dur: float = 0.06, body: float = 450.0, ring=(1900.0, 3100.0, 4700.0), ring_tau: float = 0.010,
          body_tau: float = 0.014, bright: float = 1.0, weight: float = 1.0, noise_tau: float = 0.004,
          lo: float = 700.0, hi: float = 9000.0) -> np.ndarray:
    """Mechanical impact: click + contact noise + dense metallic ring + low 'body' knock.

    `ring` lists the main ring partials (two random upper partials are added for
    density); `weight` scales the low body knock, `bright` the click/noise/ring."""
    n = ns(dur)
    out = np.zeros(n)
    put(out, click(rng, 1.2, 1800.0), 0.0, 1.0 * bright)
    out += 0.9 * bright * burst(n, rng, lo, hi, noise_tau)
    ring = list(ring) + [ring[-1] * rng.uniform(1.25, 1.45), ring[-1] * rng.uniform(1.6, 1.9)]
    taus = [ring_tau / (1.0 + 0.3 * i) for i in range(len(ring))]
    amps = [0.85 / (1.0 + 0.45 * i) for i in range(len(ring))]
    out += bright * modal(n, ring, taus, amps, rng=rng, detune=0.03)
    out += 0.5 * weight * modal(n, [body, body * 2.07], [body_tau, body_tau * 0.55], [0.9, 0.35])
    return out


def knock(n: int, f: float, tau: float, drop: float = 1.25, h: float = 0.3) -> np.ndarray:
    """Dull pitched knock (hollow / wooden / plastic): damped sine with a small pitch drop."""
    ph = phasor(exp_sweep(n, f * drop, f, tau * 0.5))
    return (np.sin(TAU * ph) + h * np.sin(TAU * 2.31 * ph)) * ad_env(n, 0.0004, tau)


# --------------------------------------------------------------------------
# friction and air
# --------------------------------------------------------------------------
def scrape(n: int, rng, f0: float, f1: float, q: float = 1.6, rough: float = 0.5, rough_hz: float = 140.0,
           env=None, wide: float = 0.25) -> np.ndarray:
    """Sliding friction: band-passed noise with a moving centre and grainy roughness."""
    y = svf(white(n, rng), log_sweep(n, f0, f1), q, "bp")
    if wide:
        y = y + wide * band(white(n + _PRE, rng), min(f0, f1) * 0.6, min(max(f0, f1) * 2.5, 16000.0))[_PRE:]
    if rough:
        r = np.abs(lp(white(n + 512, rng), rough_hz))[512:]
        r = r / (np.mean(r) + 1e-9)
        y = y * ((1.0 - rough) + rough * np.minimum(r, 3.0))
    if env is not None:
        y = y * env
    return norm(y)


def whoosh(n: int, rng, f0: float, fpk: float, f1: float, q: float = 1.3, peak_pos: float = 0.5,
           rise: float = 2.0, fall: float = 2.0, air: float = 0.25, floor: float = 0.03) -> np.ndarray:
    """Air movement: noise through a band-pass sweeping f0 -> fpk -> f1 under a swell envelope."""
    env = bell_env(n, peak_pos, rise, fall, floor)
    k = max(1, min(n - 1, int(peak_pos * n)))
    fc = np.concatenate([log_sweep(k, f0, fpk), log_sweep(n - k, fpk, f1)])
    y = svf(pink(n, rng), fc, q, "bp") * env
    if air:
        y = y + air * 0.5 * norm(bhp(white(n, rng), max(fpk * 1.5, 3000.0), 2)) * env**1.5 * peak(y)
    return norm(y)


def rustle(n: int, rng, lo: float = 500.0, hi: float = 5500.0, bumps: int = 3, grain_hz: float = 90.0,
           floor: float = 0.05) -> np.ndarray:
    """Cloth / gear rustle: soft band-limited noise under a few overlapping swells with fibre grain."""
    x = band(white(n + _PRE, rng), lo, hi)[_PRE:]
    u = np.arange(n) / n
    env = np.full(n, floor)
    for i in range(bumps):
        c = (i + rng.uniform(0.25, 0.75)) / bumps
        w = rng.uniform(0.5, 1.0) / bumps
        env += rng.uniform(0.55, 1.0) * np.exp(-0.5 * ((u - c) / (0.45 * w)) ** 2)
    env *= np.where(u > 0.65, np.cos(0.5 * np.pi * np.clip((u - 0.65) / 0.35, 0.0, 1.0)) ** 2, 1.0)   # tail off
    g = np.abs(lp(white(n + 512, rng), grain_hz))[512:]
    g = g / (np.mean(g) + 1e-9)
    return norm(x * env * (0.45 + 0.55 * np.minimum(g, 3.0)))


# --------------------------------------------------------------------------
# tones
# --------------------------------------------------------------------------
def sweep_tone(n: int, f0: float, f1: float, tau: float, wave: str = "saw", pw: float = 0.5) -> np.ndarray:
    f = exp_sweep(n, f0, f1, tau)
    if wave == "saw":
        return saw(f)
    if wave == "square":
        return square(f, pw=pw)
    if wave == "tri":
        return tri(f)
    return sine(f)


def vibe(n: int, f: float, tau: float = 0.35, trem_hz: float = 5.5, trem: float = 0.18, bright: float = 1.0,
         rng=None, mallet: float = 0.3) -> np.ndarray:
    """Vibraphone-like bar: tuned partials 1 : 4 : 10, motor tremolo, soft mallet thump."""
    t = tt(n)
    y = modal(n, [f, 4.0 * f, 10.02 * f], [tau, tau * 0.28, tau * 0.08], [1.0, 0.22 * bright, 0.07 * bright])
    y = y * (1.0 - trem * (0.5 - 0.5 * np.cos(TAU * trem_hz * t)))
    if mallet and rng is not None:
        y = y + mallet * burst(n, rng, 180.0, min(5.0 * f, 5000.0), 0.0035)
    return y


def bell(n: int, f: float, tau: float = 0.3, bright: float = 1.0) -> np.ndarray:
    """Small clean bell / glockenspiel note (sine-phase partials, no click)."""
    freqs = [f, 2.0 * f, 2.756 * f, 5.404 * f, 8.933 * f]
    taus = [tau, tau * 0.6, tau * 0.45, tau * 0.22, tau * 0.1]
    amps = [1.0, 0.18, 0.42 * bright, 0.2 * bright, 0.08 * bright]
    return modal(n, freqs, taus, amps)


def servo(n: int, rng, f_lo: float, f_hi: float, shape=(0.15, 0.75), gear: float = 7.0, rough: float = 0.35,
          res: float = 1900.0) -> np.ndarray:
    """Small geared motor: pitch ramps up, holds, winds down; gear whine and tooth chatter."""
    u = np.arange(n) / n
    a, b = shape
    contour = np.where(u < a, u / max(a, 1e-6), np.where(u < b, 1.0, np.maximum(1.0 - (u - b) / max(1.0 - b, 1e-6), 0.0)))
    contour = contour**0.6
    f = f_lo + (f_hi - f_lo) * contour
    car = 0.6 * square(f, pw=0.32) + 0.35 * saw(f * 2.005) + 0.25 * sine(np.minimum(f * gear, 9000.0))
    am = 1.0 - rough * (0.5 + 0.5 * np.sign(square(f * 0.25)))
    y = peq(bbp(car * lp1(am, 2500.0), 350.0, 7000.0), res, 2.0, 8.0)
    y = y + 0.12 * peak(y) * bbp(white(n, rng), 2500.0, 7000.0) * (0.4 + 0.6 * contour)
    env = fade(np.ones(n), 0.004, 0.02) * (0.55 + 0.45 * contour)
    return norm(y * env)


# --------------------------------------------------------------------------
# space, scatter, mastering
# --------------------------------------------------------------------------
def room(x, rng, size: float = 0.012, gain: float = 0.18, n_taps: int = 5, lp_fc: float = 4500.0) -> np.ndarray:
    """A handful of early reflections (close walls / ground), no diffuse tail."""
    tl = []
    for i in range(n_taps):
        t = size * (0.5 + rng.uniform(0.0, 1.5) * (i + 1) / n_taps)
        tl.append((t, gain * float(rng.choice([-1.0, 1.0])) * 0.9**i, lp_fc * 0.85**i))
    return taps(x, tl)


def scatter(n: int, rng, count: int, t0: float, t1: float, make, g_lo: float = 0.2, g_hi: float = 1.0,
            early: float = 2.0, fall: float = 0.0) -> np.ndarray:
    """Scatter `count` small events made by make(rng) between t0 and t1 (denser early on)."""
    out = np.zeros(n)
    for _ in range(count):
        u = rng.uniform() ** early
        g = rng.uniform(g_lo, g_hi) * (1.0 - fall * u)
        put(out, make(rng), t0 + (t1 - t0) * u, g)
    return out


def master(x, drive: float = 1.5, low_db: float = 0.0, high_db: float = 0.0, lofi_sr: float | None = None,
           bits: int = 0, lim_ms: float = 1.5, hp_fc: float | None = None) -> np.ndarray:
    """Finishing chain: tone shelves -> tanh saturation -> optional lo-fi -> hard limiter."""
    x = norm(np.asarray(x, dtype=float))
    if hp_fc:
        x = bhp(x, hp_fc, 2)
    if low_db:
        x = loshelf(x, 180.0, low_db)
    if high_db:
        x = hishelf(x, 6500.0, high_db)
    x = norm(x)
    if drive:
        x = softclip(x, drive)
    if lofi_sr:
        x = lofi(x, lofi_sr, bits)
    return limiter(x, 1.0, lim_ms)
