"""Loot: pickups, drops, rarity stings and the loot chest.

Pickups pair a physical 'grab' (clacks, clinks, cloth) with a short tonal tag
in the shared E / G pitch set, so each item type is recognisable with eyes shut.
"""
from __future__ import annotations

from kit import *  # noqa: F401,F403
from registry import sound


def _brass_clink(rng, lo: float = 3200.0, hi: float = 6200.0, tau: float = 0.016):
    f = lo * (hi / lo) ** rng.uniform()
    return ping(ns(0.07), rng, f, tau * rng.uniform(0.7, 1.3), partials=((1.0, 1.0), (1.51, 0.5), (2.76, 0.4)))


@sound("pickup_ammo", fade=0.08)
def pickup_ammo(rng, j, v):
    """Ammo: box clack, a rattle of brass, stow clack with a small rising tag."""
    n = ns(0.30)
    x = np.zeros(n)
    put(x, clack(rng, 0.05, body=420.0, ring=(1700.0, 2800.0), ring_tau=0.008, weight=1.2), 0.0, 0.8)
    for i in range(6):
        put(x, _brass_clink(rng), 0.02 + i * 0.022 + rng.uniform(-0.004, 0.004), 0.5 - 0.045 * i)
    put(x, clack(rng, 0.07, body=300.0, ring=(1500.0, 2500.0, 3900.0), ring_tau=0.010, weight=1.4), 0.15, 0.7)
    m = ns(0.09)
    tag = tri(log_sweep(m, NOTE["E5"], NOTE["B5"])) * bell_env(m, 0.3, 1.0, 1.5, 0.1)
    put(x, blp(tag, 4000.0, 2), 0.16, 0.25)
    return master(room(x, rng, 0.008, 0.12), drive=1.7, low_db=1.0, lofi_sr=32000)


@sound("pickup_cash", fade=0.10)
def pickup_cash(rng, j, v):
    """Cash: 'cha' (till lever and coins) - 'ching' (bright B6 bell with coin shimmer)."""
    n = ns(0.38)
    x = np.zeros(n)
    put(x, clack(rng, 0.06, body=350.0, ring=(1400.0, 2300.0, 3700.0), ring_tau=0.010, weight=1.3), 0.0, 0.8)
    for _ in range(5):
        put(x, _brass_clink(rng, 4200.0, 7500.0, 0.010), rng.uniform(0.005, 0.08), rng.uniform(0.2, 0.35))
    put(x, bell(n, NOTE["B6"], 0.12, bright=1.2), 0.095, 0.9)
    put(x, bell(n, NOTE["F#7"], 0.09, bright=1.0), 0.095, 0.5)
    put(x, click(rng, 0.8, 3000.0), 0.095, 0.4)
    for _ in range(6):
        put(x, _brass_clink(rng, 5000.0, 9000.0, 0.022), rng.uniform(0.10, 0.25), rng.uniform(0.15, 0.3))
    x = reverb(x, rng, t60=0.25, mix_=0.25, lo=600.0, hi=9000.0)
    return master(x, drive=1.5, lofi_sr=32000)


@sound("pickup_health", fade=0.10)
def pickup_health(rng, j, v):
    """Health: warm G4->G5 glide with little bubbles, resolved by a soft major-third bell."""
    n = ns(0.35)
    m = ns(0.26)
    f = log_sweep(m, NOTE["G4"], NOTE["G5"])
    glide = (sine(f) + 0.4 * tri(f) + 0.7 * sine(f * 1.0035) + 0.25 * sine(f * 0.5)) * ad_env(m, 0.01, 0.15)
    x = np.zeros(n)
    put(x, glide, 0.0, 0.8)
    put(x, click(rng, 0.8, 1500.0), 0.0, 0.2)
    for t in (0.02, 0.07, 0.12):
        k = ns(0.03)
        put(x, sine(log_sweep(k, j(600.0), j(1250.0))) * bell_env(k, 0.3, 1.0, 1.5, 0.1), t, 0.25)
    put(x, bell(n, NOTE["G6"], 0.10), 0.16, 0.5)
    put(x, bell(n, NOTE["B6"], 0.08), 0.19, 0.35)
    x = reverb(x, rng, t60=0.3, mix_=0.3, lo=300.0, hi=7000.0)
    return master(x, drive=1.4, low_db=1.0, lofi_sr=32000)


@sound("pickup_weapon", fade=0.09)
def pickup_weapon(rng, j, v):
    """Weapon: heavy grab, sling rattle, action racked home, with a low E power-fifth under it."""
    n = ns(0.36)
    x = np.zeros(n)
    put(x, rustle(ns(0.12), rng, 400.0, 4500.0, bumps=2, floor=0.15), 0.0, 0.3)
    put(x, clack(rng, 0.08, body=300.0, ring=(1500.0, 2500.0, 3900.0), ring_tau=0.012, weight=1.6), 0.0, 0.9)
    put(x, thump(ns(0.1), 150.0, 80.0, 0.015, 0.03), 0.0, 0.5)
    for t in (0.06, 0.10):
        put(x, clack(rng, 0.03, body=1000.0, ring=(2600.0, 4200.0), ring_tau=0.004, weight=0.4, bright=0.7), t, 0.2)
    m = ns(0.05)
    put(x, scrape(m, rng, 1500.0, 3000.0, q=1.6, rough=0.5, env=bell_env(m, 0.7, 1.0, 0.8, 0.15)), 0.13, 0.35)
    put(x, clack(rng, 0.10, body=260.0, ring=(1700.0, 2900.0, 4500.0), ring_tau=0.014, body_tau=0.025, weight=1.8), 0.185, 1.0)
    k = ns(0.17)
    fifth = blp(saw(NOTE["A2"], k) + saw(NOTE["E3"], k), 700.0, 2) * ad_env(k, 0.01, 0.07)
    put(x, fifth, 0.185, 0.25)
    return master(room(x, rng, 0.008, 0.12), drive=1.9, low_db=1.5, lofi_sr=32000)


@sound("pickup_mine", fade=0.07)
def pickup_mine(rng, j, v):
    """Mine pocketed: hollow disc clunk, latch whirr, falling A6->E6 'safe' blips."""
    n = ns(0.30)
    x = np.zeros(n)
    put(x, clack(rng, 0.08, body=240.0, ring=(900.0, 1500.0, 2400.0), ring_tau=0.014, body_tau=0.02, weight=1.6), 0.0, 1.0)
    put(x, ping(ns(0.15), rng, 520.0, 0.04, partials=SHELL, detune=0.02), 0.0, 0.4)
    put(x, servo(ns(0.08), rng, 500.0, 900.0, shape=(0.3, 0.6)), 0.05, 0.22)
    for t, name in ((0.14, "A6"), (0.20, "E6")):
        k = ns(0.05)
        tone = (0.6 * square(NOTE[name], k) + 0.6 * sine(NOTE[name], k)) * fade(np.ones(k), 0.002, 0.012)
        put(x, bp(tone, 2200.0, 1.0) + 0.3 * tone, t, 0.4)
    return master(room(x, rng, 0.008, 0.1), drive=1.7, low_db=1.0, lofi_sr=32000)


@sound("loot_drop", fade=0.09)
def loot_drop(rng, j, v):
    """Item popping out of a container: cartoon 'bloop', a puff of air and a glint."""
    n = ns(j(0.30, 0.06))
    x = np.zeros(n)
    m = ns(0.12)
    f = np.minimum(exp_sweep(m, j(300.0), j(1050.0), 0.022), 1100.0)       # fast rising chirp
    pop = (sine(f) + 0.3 * sine(2.0 * f)) * ad_env(m, 0.002, j(0.04))
    put(x, pop, 0.0, 1.0)
    put(x, thump(ns(0.1), j(170.0), j(90.0), 0.015, 0.03), 0.0, 0.5)
    put(x, click(rng, 1.0, 2000.0), 0.0, 0.4)
    put(x, whoosh(ns(0.18), rng, 800.0, 3000.0, 1500.0, q=1.3, peak_pos=0.3, floor=0.08), 0.0, 0.35)
    top = (1.0, 1.122)[v % 2]
    put(x, bell(ns(0.2), NOTE["E7"] * top, 0.06), 0.06, 0.3)
    put(x, bell(ns(0.15), NOTE["B7"] * top, 0.04), 0.10, 0.2)
    return master(x, drive=1.6, low_db=1.0, lofi_sr=32000)


@sound("loot_rare", fade=0.22)
def loot_rare(rng, j, v):
    """Rare drop: rising E-major glockenspiel run, swelling pad and a spray of sparkles."""
    n = ns(0.85)
    x = np.zeros(n)
    for i, name in enumerate(["E6", "G#6", "B6", "E7"]):
        put(x, bell(n, NOTE[name], 0.18), 0.06 * i, 0.5 + 0.08 * i)
    put(x, bell(n, NOTE["B7"], 0.16, bright=1.2), 0.26, 0.5)
    m = ns(0.7)
    pad = sum(saw(NOTE[nm] * d, m) for nm in ("E4", "B4", "E5", "G#5") for d in (0.997, 1.003))
    pad = svf(pad, points(m, [(0.0, 600.0), (0.3, 4000.0), (0.7, 2500.0)], "exp"), 0.9, "lp")
    put(x, norm(pad) * bell_env(m, 0.4, 1.2, 1.5, 0.05), 0.0, 0.35)
    put(x, whoosh(ns(0.35), rng, 600.0, 5000.0, 4000.0, q=1.2, peak_pos=0.8, floor=0.05), 0.0, 0.3)

    def glint(r):
        f = 4000.0 * 2.5 ** r.uniform()
        return ping(ns(0.2), r, f, r.uniform(0.03, 0.08), partials=BAR)

    x += scatter(n, rng, 14, 0.2, 0.7, glint, 0.1, 0.3, early=1.0, fall=0.5)
    x = reverb(x, rng, t60=0.6, mix_=0.45, lo=400.0, hi=9000.0)
    return master(x, drive=1.4, lofi_sr=32000)


@sound("loot_legendary", fade=0.40)
def loot_legendary(rng, j, v):
    """Legendary drop: low hit, brassy E-major(add9) synth-orchestra chord, upward gliss, shimmer."""
    n = ns(1.70)
    t = tt(n)
    x = np.zeros(n)
    # the hit
    x += 0.6 * thump(n, 110.0, 45.0, 0.04, 0.2, h2=0.2)
    x += 0.6 * burst(n, rng, 200.0, 2500.0, 0.05)
    put(x, click(rng, 2.0, 1500.0), 0.0, 0.6)
    x += 0.25 * burst(n, rng, 4000.0, 12000.0, 0.5, attack=0.004)                 # cymbal wash
    x += 0.3 * sine(NOTE["E2"], n) * ad_env(n, 0.02, 0.5)
    # brass / string-machine chord with a filter 'blat' that opens and settles
    vib = 1.0 + 0.004 * np.sin(TAU * 5.5 * t) * np.clip((t - 0.3) / 0.3, 0.0, 1.0)
    chord = np.zeros(n)
    for name, g in (("E3", 1.0), ("B3", 0.9), ("E4", 0.9), ("G#4", 0.8), ("B4", 0.7), ("F#5", 0.5)):
        for d in (0.9971, 1.0029):
            chord += g * saw(NOTE[name] * d * vib)
    cutoff = points(n, [(0.0, 500.0), (0.07, 4200.0), (0.5, 2400.0), (1.7, 1500.0)], "exp")
    chord = svf(chord, cutoff, 0.8, "lp") * ad_env(n, 0.03, 0.75)
    put(x, norm(chord), 0.02, 0.7)
    # harp / glock gliss: E major pentatonic, two octaves in ~0.28 s
    names = ["E5", "F#5", "G#5", "B5", "C#6", "E6", "F#6", "G#6", "B6", "C#7", "E7"]
    for i, name in enumerate(names):
        put(x, bell(ns(0.9), NOTE[name], 0.25 - 0.01 * i), 0.05 + 0.026 * i, 0.22 + 0.01 * i)
    # sustained top shimmer
    m = ns(1.2)
    top = sum(bell(m, NOTE[nm], 0.5) for nm in ("E7", "G#7", "B7")) * (1.0 - 0.35 * (0.5 + 0.5 * np.sin(TAU * 9.0 * tt(m))))
    put(x, top, 0.34, 0.2)
    x = reverb(x, rng, t60=1.2, mix_=0.6, lo=150.0, hi=8000.0)
    return master(x, drive=1.6, low_db=1.0, lofi_sr=32000)


@sound("chest_open", fade=0.15)
def chest_open(rng, j, v):
    """Loot chest: two latches, pressure pop and hiss, servo lid, heavy stop thunk."""
    n = ns(1.10)
    x = np.zeros(n)
    put(x, clack(rng, 0.07, body=360.0, ring=(1300.0, 2100.0, 3400.0), ring_tau=0.012, weight=1.5), 0.0, 0.9)
    put(x, clack(rng, 0.07, body=330.0, ring=(1200.0, 1950.0, 3150.0), ring_tau=0.012, weight=1.5), 0.14, 0.8)
    put(x, thump(ns(0.1), 180.0, 90.0, 0.01, 0.03), 0.20, 0.5)
    m = ns(0.5)
    hiss = bp(bhp(white(m, rng), 2500.0, 2), 6000.0, 0.7) * ad_env(m, 0.01, 0.12)
    put(x, norm(hiss), 0.20, 0.6)
    k = ns(0.55)
    put(x, servo(k, rng, 180.0, 420.0, shape=(0.2, 0.8), gear=6.0, res=1200.0), 0.30, 0.42)
    put(x, sine(log_sweep(k, 70.0, 110.0)) * bell_env(k, 0.5, 1.0, 1.0, 0.05), 0.30, 0.25)
    creak = svf(white(k, rng), 500.0 + 300.0 * slow_noise(k, rng, 9.0), 12.0, "bp") * slow_noise(k, rng, 6.0) ** 2
    put(x, norm(creak) * bell_env(k, 0.5, 1.0, 1.0), 0.32, 0.18)
    put(x, clack(rng, 0.12, body=200.0, ring=(800.0, 1400.0, 2300.0), ring_tau=0.02, body_tau=0.03, weight=2.0), 0.88, 1.0)
    put(x, thump(ns(0.2), 120.0, 60.0, 0.02, 0.06), 0.88, 0.7)
    x = reverb(x, rng, t60=0.4, mix_=0.3, lo=200.0, hi=6000.0)
    return master(x, drive=1.8, low_db=1.5, lofi_sr=32000)
