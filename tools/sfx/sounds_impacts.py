"""Bullet impacts per surface, ricochets and near-miss fly-bys.

Impact recipe: hard click + surface-specific body (noise bands and/or modal
ring) + a low knock for weight + late detail (chips, dust, sparks, fizz).
"""
from __future__ import annotations

from kit import *  # noqa: F401,F403
from registry import sound


def _chip(rng):
    """One falling chip / grain: a 2-3 ms band-passed tick."""
    n = ns(0.012)
    f = rng.uniform(1800.0, 6000.0)
    return bp(burst(n, rng, 800.0, 9000.0, rng.uniform(0.0012, 0.003)), f, 2.0)


@sound("impact_concrete", fade=0.08)
def impact_concrete(rng, j, v):
    """Round into concrete: sharp crack, mid 'pock', chips and a puff of dust."""
    n = ns(j(0.28, 0.08))
    x = multiband(n, rng, [
        (1000.0, 6500.0, j(0.011), 1.0),
        (300.0, 1300.0, j(0.022), 0.8),
        (2500.0, 9000.0, j(0.055), 0.16, 0.004),      # dust hiss
    ])
    put(x, click(rng, 1.5, 1500.0), 0.0, 1.0)
    x += 0.5 * knock(n, j(310.0), 0.012)
    x += scatter(n, rng, int(rng.integers(5, 9)), 0.03, 0.20, _chip, 0.08, 0.26, early=1.3, fall=0.5)
    return master(room(x, rng, 0.012, 0.15), drive=2.0, low_db=1.0, lofi_sr=32000)


@sound("impact_metal", fade=0.10)
def impact_metal(rng, j, v):
    """Round into steel plate: bright clang with inharmonic, beating ring."""
    n = ns(j(0.33, 0.06))
    f = j(1150.0) * (1.0, 0.86, 1.17)[v % 3]
    x = 0.9 * burst(n, rng, 1500.0, 10000.0, 0.004)
    put(x, click(rng, 1.2, 2000.0), 0.0, 1.0)
    x += 0.7 * ping(n, rng, f, j(0.085), partials=PLATE, detune=0.03)
    x += 0.5 * ping(n, rng, f * j(2.5), j(0.06), partials=BAR, detune=0.03)
    x += 0.3 * modal(n, [f * 1.0, f * 1.013], [0.08, 0.07], [1.0, 0.9], rng=rng)      # slow beat
    x += 0.5 * knock(n, j(420.0), 0.015)
    x += 0.15 * burst(n, rng, 5000.0, 12000.0, 0.02)
    return master(room(x, rng, 0.010, 0.12, lp_fc=7000.0), drive=1.8, lofi_sr=32000)


@sound("impact_sand", fade=0.10)
def impact_sand(rng, j, v):
    """Round into sand: soft 'pfft', dull thud and a spray of grains."""
    n = ns(j(0.30, 0.08))
    x = 1.0 * burst(n, rng, 300.0, 3000.0, j(0.045), attack=0.003)
    x += 0.3 * thump(n, j(130.0), j(70.0), 0.02, j(0.03))
    spray_env = ad_env(n, 0.006, j(0.08))
    x += 0.35 * crackle(n, rng, rate=2500.0, tau=0.0004, hp_fc=3000.0, env=spray_env)
    x += 0.25 * burst(n, rng, 2000.0, 8000.0, j(0.07), attack=0.01)
    return master(x, drive=1.5, high_db=-2.0, lofi_sr=32000)


@sound("impact_wood", fade=0.07)
def impact_wood(rng, j, v):
    """Round into wood: hollow 'tok', splintering crack, a few splinter ticks."""
    n = ns(j(0.25, 0.08))
    x = 1.0 * knock(n, j(380.0), 0.022, drop=1.2, h=0.4)
    x += 0.8 * modal(n, j.each([820.0, 1340.0, 2150.0]), [0.016, 0.011, 0.007], [0.6, 0.4, 0.25], rng=rng)
    x += 0.6 * burst(n, rng, 1500.0, 6000.0, 0.008)
    put(x, click(rng, 1.5, 1200.0), 0.0, 0.7)
    x += scatter(n, rng, int(rng.integers(3, 6)), 0.02, 0.12, _chip, 0.1, 0.26, early=1.0, fall=0.4)
    return master(room(x, rng, 0.010, 0.14), drive=1.8, low_db=1.0, lofi_sr=32000)


@sound("impact_robot", fade=0.09)
def impact_robot(rng, j, v):
    """Round into an Associate: hollow shell clang plus an electric spit of sparks."""
    n = ns(j(0.33, 0.06))
    f = j(620.0) * (1.0, 0.88, 1.14)[v % 3]
    x = 0.8 * burst(n, rng, 1200.0, 9000.0, 0.005)
    put(x, click(rng, 1.2, 1800.0), 0.0, 1.0)
    x += 0.8 * ping(n, rng, f, j(0.05), partials=SHELL, detune=0.03)
    x += 0.4 * ping(n, rng, j(1900.0), j(0.035), partials=BAR, detune=0.03)
    x += 0.5 * knock(n, 210.0, 0.018)
    # electric spit: stuttering arc + sparks + a falling zap chirp
    m = ns(0.17)
    put(x, arc(m, rng, f=j(115.0), bright=3200.0, stutter=45.0) * ad_env(m, 0.004, j(0.055)), 0.012, 0.6)
    m2 = ns(0.2)
    put(x, crackle(m2, rng, rate=180.0, tau=0.0005, hp_fc=3500.0, env=exp_env(m2, 0.07)), 0.02, 0.4)
    m3 = ns(0.07)
    put(x, fm(exp_sweep(m3, j(2600.0), 900.0, 0.02), 173.0, 2.5) * ad_env(m3, 0.001, 0.02), 0.015, 0.22)
    return master(room(x, rng, 0.010, 0.12), drive=2.0, lofi_sr=32000, bits=12)


@sound("impact_flesh", fade=0.08)
def impact_flesh(rng, j, v):
    """Dull, wet body thud (Strikers / the player's side): no highs, no ring."""
    n = ns(j(0.24, 0.08))
    x = 0.6 * thump(n, j(150.0), j(75.0), 0.018, j(0.04), h2=0.2)
    x += 0.9 * blp(burst(n, rng, 150.0, 1100.0, j(0.03), attack=0.002), 1200.0, 2)
    m = ns(0.12)
    sq = svf(pink(m, rng), log_sweep(m, j(700.0), 280.0), 2.5, "bp") * ad_env(m, 0.004, 0.035)
    put(x, norm(sq), 0.004, 0.4)
    x = blp(x, 2600.0, 2)
    return master(x, drive=2.2, low_db=2.0, lofi_sr=32000)


@sound("impact_shield", fade=0.10)
def impact_shield(rng, j, v):
    """Round stopped by an energy shield: glassy ping, 95 Hz-gated fizz, shimmer."""
    n = ns(j(0.30, 0.06))
    t = tt(n)
    f = exp_sweep(n, j(2600.0), j(1500.0), 0.03)
    x = 0.7 * (sine(f) + 0.3 * sine(f * 2.0)) * ad_env(n, 0.0005, j(0.05))
    x += 0.4 * fm(f, f * 1.41, 3.0 * np.exp(-t / 0.04)) * ad_env(n, 0.0, 0.04)
    gate = 0.5 + 0.5 * np.sign(square(j(95.0), n))
    x += 0.5 * norm(bhp(white(n, rng), 3000.0, 2) * lp1(gate, 3000.0)) * ad_env(n, 0.0, j(0.07))
    x += 0.3 * modal(n, j.each([4200.0, 5100.0, 6300.0, 7400.0]), [0.06, 0.05, 0.04, 0.03], [1.0, 0.8, 0.6, 0.5], rng=rng)
    x += 0.3 * sine(exp_sweep(n, 190.0, 140.0, 0.05)) * ad_env(n, 0.002, 0.05)
    put(x, click(rng, 1.0, 3000.0), 0.0, 0.5)
    x = reverb(x, rng, t60=0.2, mix_=0.4, lo=500.0, hi=9000.0)
    return master(x, drive=1.6, lofi_sr=32000)


@sound("ricochet", fade=0.18)
def ricochet(rng, j, v):
    """Pitch-bending ricochet whine: impact tick, then a tumbling fragment flying away."""
    n = ns(j(0.62, 0.08))
    t = tt(n)
    f0 = j(4200.0) * (1.0, 1.25, 0.8)[v % 3]
    f1 = j(1300.0) * (1.0, 1.1, 0.75)[v % 3]
    tau = j(0.22) * (1.0, 0.7, 1.2)[v % 3]
    rise = (0.12, 0.05, 0.30)[v % 3]                       # v3 swoops up before it falls: "pyeeow"
    f = (f1 + (f0 - f1) * np.exp(-t / tau)) * (1.0 - rise * np.exp(-t / 0.014))
    tumble = phasor(log_sweep(n, j(58.0), 24.0))           # tumbling slows as it loses energy
    f = f * (1.0 + 0.025 * np.sin(TAU * tumble))
    tone = sine(f) + 0.35 * sine(2.0 * f) + 0.15 * sine(3.0 * f)
    air = svf(white(n, rng), f, 25.0, "bp")
    whine = (tone + 0.5 * norm(air) * 1.4) * ad_env(n, 0.004, j(0.16)) * (1.0 - 0.35 * (0.5 + 0.5 * np.sin(TAU * tumble)))
    x = 0.8 * norm(whine)
    x += 0.8 * burst(n, rng, 2000.0, 9000.0, 0.004)
    put(x, click(rng, 1.2, 2000.0), 0.0, 0.9)
    x += 0.3 * ping(n, rng, j(2400.0), 0.03, partials=PLATE, detune=0.03)
    x = reverb(x, rng, t60=0.5, mix_=0.5, lo=400.0, hi=7000.0)
    return master(x, drive=1.5, lofi_sr=32000)


@sound("bullet_whiz", fade=0.10)
def bullet_whiz(rng, j, v):
    """Near-miss fly-by: Doppler-dropping 'zzip' of air and buzz, tiny snap as it passes."""
    n = ns(j(0.30, 0.08))
    t = tt(n)
    pk = (0.36, 0.42, 0.32)[v % 3]
    env = bell_env(n, pk, 3.0, 2.0, 0.03)
    dop = 1.0 + 0.22 * np.tanh((pk * n / SR - t) / 0.025)             # approach high, recede low
    f0 = j(520.0) * (1.0, 1.2, 0.85)[v % 3]
    buzz = svf(saw(f0 * dop), 3.0 * f0 * dop, 2.0, "bp")
    air = svf(white(n, rng), j(2800.0) * dop, 3.0, "bp")
    x = (1.0 * norm(air) + 0.5 * norm(buzz)) * env
    put(x, click(rng, 0.8, 3500.0), pk * n / SR, 0.3)
    return master(x, drive=1.5, hp_fc=150.0, lofi_sr=32000)
