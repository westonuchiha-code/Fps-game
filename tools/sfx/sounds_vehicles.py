"""Vehicles: the Teamster 4x4 (engine, skid, crash, turret) and the Vesper hover scooter.

The engine / hover loops are built to be pitch-shifted by the game (playbackRate
0.6x - 2.2x): every tonal and pulse layer completes a whole number of cycles in
the loop, so they are exactly periodic at any playback rate.
"""
from __future__ import annotations

from kit import *  # noqa: F401,F403
from registry import sound


# --------------------------------------------------------------------------
# Teamster 4x4
# --------------------------------------------------------------------------
@sound("truck_engine_loop")
def truck_engine_loop(rng, j, v):
    """Throaty V8-style loop, 2.000 s = 22 engine cycles (176 firing pulses, 88 Hz firing rate).

    Cross-plane burble: the eight cylinders fire evenly but feed two exhaust
    banks in the irregular order L R R L R L L R with unequal strengths, and the
    listener hears one bank much louder than the other - so the spectrum carries
    strong half-order lines (33 / 55 / 77 / 99 / 121 ... Hz) around the 88 Hz
    firing line: the 'potato-potato' lope.  Pulses are placed circularly (tails
    wrap around the loop point), tonal layers complete whole cycles and all
    filtering runs on a tiled copy, so the loop is periodic by construction."""
    n = ns(2.0)
    t = np.arange(n) / SR
    cycles = 22
    cyc = n / cycles / SR                                  # seconds per engine cycle (two crank revs)
    banks = [np.zeros(n), np.zeros(n)]
    order = [0, 1, 1, 0, 1, 0, 0, 1]
    strength = [1.0, 0.6, 0.85, 0.5, 0.95, 0.65, 0.8, 0.55]
    m = ns(0.010)
    tp = tt(m)
    pop = (tp / 0.0008) * np.exp(1.0 - tp / 0.0008)       # exhaust pressure pulse: fast rise, <1 ms decay
    ticks = np.zeros(n)
    for c in range(cycles):
        for k in range(8):
            t0 = (c + k / 8.0) * cyc + rng.uniform(-0.0003, 0.0003)
            g = strength[k] * rng.uniform(0.9, 1.1)
            pulse = pop + 0.4 * burst(m, rng, 300.0, 3000.0, 0.0025)
            put_wrap(banks[order[k]], pulse, t0, g)
            put_wrap(ticks, click(rng, 0.5, 2500.0), t0 + 0.004, 0.5 * rng.uniform(0.5, 1.0))   # valve train

    def pipe(z, f1, f2, f3, f4):
        z = blp(z, 2500.0, 2)
        return peq(peq(peq(peq(z, f1, 2.0, 4.0), f2, 2.5, 7.0), f3, 3.0, 9.0), f4, 3.0, 7.0)

    near = loop_apply(banks[0], lambda z: pipe(z, 95.0, 190.0, 380.0, 760.0))
    far = loop_apply(banks[1], lambda z: pipe(z, 104.0, 215.0, 450.0, 820.0))
    x = norm(near + 0.3 * np.roll(far, ns(0.0015)))        # far bank: quieter and 1.5 ms later
    growl = loop_apply(saw(88.0, n) * (1.0 + 0.3 * np.sin(TAU * 11.0 * t)), lambda z: blp(z, 900.0, 2))
    firing_env = loop_apply(np.abs(banks[0] + banks[1]), lambda z: lp1(z, 60.0))
    firing_env = firing_env / (np.max(firing_env) + 1e-9)
    mech = circ_band_noise(n, rng, 400.0, 3500.0, slope_db_oct=-3.0) * (0.35 + 0.65 * firing_env)
    x = x + 0.15 * norm(growl) + 0.12 * mech + 0.04 * norm(ticks)
    x = asym(x * 0.9, 2.2, 0.25)                           # tube-ish, even harmonics = throat
    return loop_apply(x, lambda z: blp(bhp(z, 35.0, 2), 4200.0, 2))


@sound("tire_skid_loop")
def tire_skid_loop(rng, j, v):
    """Tyre skid, 1.300 s loop: rough friction noise, wandering screech resonances, low rumble.

    Stochastic material: rendered 0.25 s long and equal-power cross-faded into its own start."""
    n = ns(1.30)
    m = n + ns(0.25)
    rough = np.abs(lp(white(m + 512, rng), 180.0))[512:]
    rough = np.minimum(rough / (np.mean(rough) + 1e-9), 3.0)
    x = 0.8 * norm(bbp(white(m, rng), 500.0, 4500.0) * (0.6 + 0.4 * rough))
    squeal = np.zeros(m)
    for fc in (j(1150.0), j(1780.0), j(2650.0)):
        f = fc * (1.0 + 0.04 * (slow_noise(m, rng, 6.0) * 2.0 - 1.0))
        squeal += norm(svf(white(m, rng), f, 28.0, "bp")) * slow_noise(m, rng, 5.0, 0.35, 1.0)
    x += 0.9 * norm(squeal)
    x += 0.45 * norm(bbp(white(m, rng), 70.0, 260.0) * slow_noise(m, rng, 8.0, 0.5, 1.0))
    x = np.tanh(1.3 * norm(x))
    return loop_xfade(x, n)


@sound("truck_impact", fade=0.14)
def truck_impact(rng, j, v):
    """Truck hits something: low thud, crumpling sheet metal, glass tinkle, rattle."""
    n = ns(j(0.55, 0.06))
    x = 0.9 * thump(n, j(95.0), j(45.0), 0.03, j(0.09), h2=0.2)
    put(x, click(rng, 2.0, 1000.0), 0.0, 1.0)

    def crunch(r):
        k = ns(0.08)
        g = burst(k, r, 400.0, 5000.0, r.uniform(0.004, 0.009))
        return g + 0.6 * ping(k, r, 300.0 * 5.0 ** r.uniform(), r.uniform(0.012, 0.03), partials=PLATE, detune=0.04)

    put(x, crunch(rng), 0.0, 0.9)
    x += scatter(n, rng, 9, 0.0, 0.16, crunch, 0.3, 0.9, early=1.0)
    x += 0.5 * ping(n, rng, j(210.0), j(0.09), partials=PLATE, detune=0.04)
    x += 0.4 * ping(n, rng, j(540.0), j(0.06), partials=PLATE, detune=0.04)
    x += scatter(n, rng, 6, 0.05, 0.35, lambda r: ping(ns(0.08), r, 4000.0 * 2.2 ** r.uniform(), 0.015), 0.08, 0.2)
    x += 0.25 * crackle(n, rng, rate=200.0, tau=0.001, hp_fc=1200.0, env=exp_env(n, 0.12))
    x += 0.25 * rumble(n, rng, 100.0, 1500.0, j(0.12), attack=0.01, roll=0.3)
    x = reverb(x, rng, t60=0.4, mix_=0.4, lo=120.0, hi=5000.0)
    return master(x, drive=2.8, low_db=2.0, lofi_sr=32000)


@sound("turret_fire", fade=0.08)
def turret_fire(rng, j, v):
    """Teamster rear turret: heavy mounted gun - deep, hard and short enough to chain."""
    n = ns(j(0.28, 0.05))
    body = multiband(n, rng, [
        (2000.0, 8000.0, j(0.005), 0.7),
        (400.0, 2200.0, j(0.016), 1.0),
        (120.0, 500.0, j(0.030), 1.0),
    ])
    body += 0.7 * res_burst(n, rng, j(620.0), 2.0, j(0.02))
    dry = body + 0.75 * thump(n, j(150.0), j(52.0), 0.02, j(0.04), h2=0.2)
    x = dry.copy()
    put(x, click(rng, 2.0, 1500.0), 0.0, 1.0)
    put(x, clack(rng, 0.07, body=j(260.0), ring=j.each((1100.0, 1900.0, 3000.0)), ring_tau=0.010, weight=1.6), j(0.030), 0.28)
    put(x, clack(rng, 0.03, body=800.0, ring=j.each((2100.0, 3400.0)), ring_tau=0.004, weight=0.5), j(0.062), 0.12)   # belt link
    x += taps(dry, [(j(0.015), 0.18, 3500.0), (j(0.033), -0.10, 2500.0)], dry=0.0)
    x += 0.08 * rumble(n, rng, 150.0, 2000.0, j(0.04), attack=0.008, roll=0.0)
    return master(x, drive=3.2, low_db=2.5, lofi_sr=32000)


@sound("vehicle_enter", fade=0.10)
def vehicle_enter(rng, j, v):
    """Climb in: grab handle click, cloth, body dropping into the seat, door clunk."""
    n = ns(0.40)
    x = np.zeros(n)
    put(x, clack(rng, 0.04, body=500.0, ring=(1600.0, 2600.0), ring_tau=0.006, weight=0.8), 0.0, 0.5)
    put(x, rustle(ns(0.16), rng, 400.0, 4000.0, bumps=2, floor=0.15), 0.0, 0.35)
    put(x, thump(ns(0.2), 135.0, 75.0, 0.02, 0.04), 0.12, 0.5)
    put(x, burst(ns(0.1), rng, 150.0, 1200.0, 0.02, attack=0.002), 0.12, 0.8)
    k = ns(0.12)
    creak = svf(white(k, rng), log_sweep(k, 600.0, 450.0), 10.0, "bp") * bell_env(k, 0.4, 1.0, 1.5)
    put(x, norm(creak), 0.14, 0.15)
    put(x, clack(rng, 0.10, body=220.0, ring=(900.0, 1500.0, 2500.0), ring_tau=0.014, body_tau=0.025, weight=1.8), 0.25, 0.9)
    put(x, thump(ns(0.12), 115.0, 70.0, 0.02, 0.035), 0.25, 0.3)
    return master(room(x, rng, 0.006, 0.12), drive=2.0, low_db=1.0, lofi_sr=32000)


@sound("vehicle_exit", fade=0.10)
def vehicle_exit(rng, j, v):
    """Climb out: door latch pops, seat springs back, cloth, boots land on the ground."""
    n = ns(0.40)
    x = np.zeros(n)
    put(x, clack(rng, 0.06, body=300.0, ring=(1200.0, 2000.0, 3300.0), ring_tau=0.010, weight=1.2), 0.0, 0.8)
    k = ns(0.10)
    creak = svf(white(k, rng), log_sweep(k, 450.0, 650.0), 10.0, "bp") * bell_env(k, 0.4, 1.0, 1.5)
    put(x, norm(creak), 0.03, 0.15)
    put(x, rustle(ns(0.18), rng, 400.0, 4000.0, bumps=2, floor=0.1), 0.03, 0.4)
    for t, g in ((0.22, 0.9), (0.245, 0.6)):
        put(x, thump(ns(0.15), 150.0, 85.0, 0.015, 0.03), t, 0.5 * g)
        put(x, burst(ns(0.06), rng, 600.0, 4000.0, 0.012), t, 0.8 * g)
        put(x, burst(ns(0.08), rng, 200.0, 1000.0, 0.018), t, 0.5 * g)
        put(x, click(rng, 1.0, 1200.0), t, 0.4 * g)
    return master(room(x, rng, 0.008, 0.12), drive=2.0, low_db=1.0, lofi_sr=32000)


# --------------------------------------------------------------------------
# Vesper hover scooter
# --------------------------------------------------------------------------
def _putt(rng, f: float = 310.0) -> np.ndarray:
    """One two-stroke 'putt': hollow damped pop plus a puff of exhaust noise."""
    m = ns(0.05)
    return (modal(m, [f, f * 2.0, f * 3.1], [0.009, 0.006, 0.004], [1.0, 0.5, 0.25])
            + 0.5 * burst(m, rng, 800.0, 2500.0, 0.004))


@sound("scooter_hover_loop")
def scooter_hover_loop(rng, j, v):
    """Vesper hover loop, 2.000 s: smooth electric whirr with a slightly comic two-stroke putter.

    Whirr: two harmonic stacks at 138.5 / 139.5 Hz (1 Hz beat) plus a vibrato'd
    upper pair and faint inverter whine - all whole cycles per loop.  Putter:
    16 Hz 'ring-ding' pops with a lazy accent pattern and the odd misfire,
    placed circularly.  Airy hover noise is FFT-synthesised periodic noise."""
    n = ns(2.0)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for f0, a0 in ((138.5, 1.0), (139.5, 0.5)):        # 1 Hz beat, kept shallow (never a full null)
        for k in range(1, 15):
            x += (a0 / k**1.3) * np.sin(TAU * k * f0 * t + rng.uniform(0, TAU))
    vib = 0.9 * np.sin(TAU * 5.0 * t)
    x += 0.7 * np.sin(TAU * 415.5 * t + vib) + 0.5 * np.sin(TAU * 554.0 * t + 1.3 * vib)
    x += 0.09 * np.sin(TAU * 1108.0 * t + 0.8 * np.sin(TAU * 3.0 * t)) + 0.05 * np.sin(TAU * 1662.0 * t)
    x = norm(x)
    air = circ_band_noise(n, rng, 500.0, 3000.0, slope_db_oct=-3.0) * periodic_lfo(n, rng, (2, 3, 6), 0.5, 1.0)
    x += 0.12 * air * 3.0
    putter = np.zeros(n)
    accents = [1.0, 0.55, 0.8, 0.5]
    for i in range(32):
        g = accents[i % 4] * rng.uniform(0.85, 1.1)
        if i % 8 == 7:
            g *= 0.25                                       # lazy misfire: "putt-putt-putt ... putt"
        put_wrap(putter, _putt(rng, 310.0 * rng.uniform(0.97, 1.03)), i / 16.0 + rng.uniform(-0.002, 0.002), g)
    x += 0.5 * norm(putter)
    x = asym(x * 0.8, 1.5, 0.15)
    return loop_apply(x, lambda z: blp(bhp(z, 45.0, 2), 6000.0, 2))


@sound("scooter_boost", fade=0.22)
def scooter_boost(rng, j, v):
    """Vesper boost: kick, turbine and jet noise spooling up, the putter racing into a 'braaap'."""
    n = ns(1.0)
    u = np.arange(n) / n
    env = points(n, [(0.0, 0.25), (0.25, 1.0), (0.8, 0.8), (1.0, 0.0)], "cos")
    f = 180.0 * (620.0 / 180.0) ** (u**0.7)
    osc = saw(f) + saw(f * 1.01) + 0.5 * square(f * 2.0, pw=0.3)
    x = 0.7 * norm(svf(osc, f * 3.0, 2.0, "bp") + 0.3 * osc) * env
    rough = np.abs(lp(white(n + 512, rng), 120.0))[512:]
    rough = np.minimum(rough / (np.mean(rough) + 1e-9), 3.0)
    jet = svf(white(n, rng), 500.0 * 9.0**u, 1.2, "bp") * (0.6 + 0.4 * rough)
    x += 0.8 * norm(jet) * env
    # putter accelerating 18 -> 70 pops per second
    ph = phasor(18.0 * (70.0 / 18.0) ** u)
    hits = np.nonzero(np.diff(np.floor(ph)) > 0)[0]
    putter = np.zeros(n)
    for i in hits:
        put(putter, _putt(rng, 330.0 * (1.0 + 0.4 * i / n)), i / SR, rng.uniform(0.8, 1.0))
    x += 0.5 * norm(putter) * points(n, [(0.0, 1.0), (0.6, 0.6), (1.0, 0.0)], "lin")
    x += 0.6 * thump(n, 170.0, 80.0, 0.02, 0.05)
    put(x, click(rng, 1.2, 1500.0), 0.0, 0.4)
    return master(x, drive=2.0, low_db=1.5, lofi_sr=32000)


@sound("scooter_blaster", fade=0.07)
def scooter_blaster(rng, j, v):
    """Vesper twin blasters: two quick triangle 'bi-bew's 38 ms apart."""
    n = ns(j(0.27, 0.05))
    x = np.zeros(n)
    for i, t0 in enumerate((0.0, j(0.038, 0.1))):
        m = ns(0.16)
        f = exp_sweep(m, j(2600.0) * (1.0, 1.06)[i], j(700.0), j(0.02))
        tone = (tri(f) + 0.6 * square(f * 1.5, pw=0.3)) * ad_env(m, 0.001, j(0.03))
        put(x, norm(svf(tone, f * 1.6, 1.8, "bp") + 0.5 * tone), t0, 0.9)
        put(x, burst(ns(0.03), rng, 3000.0, 9000.0, 0.006), t0, 0.35)
        put(x, thump(ns(0.08), j(240.0), j(120.0), 0.012, 0.02), t0, 0.4)
        put(x, click(rng, 0.8, 3000.0), t0, 0.4)
    x = taps(x, [(j(0.05), 0.15, 3500.0), (j(0.09), 0.08, 2500.0)])
    return master(x, drive=1.7, low_db=1.0, lofi_sr=30000, bits=12)


@sound("scooter_horn", fade=0.08)
def scooter_horn(rng, j, v):
    """Vesper horn: a cute nasal 'meep' - two buzzy reeds a major third apart, 'm' onset, clipped 'p' ending."""
    n = ns(0.45)
    m = ns(0.36)
    tm = tt(m)
    f = NOTE["F#5"] * (1.0 - 0.10 * np.exp(-tm / 0.012)) * (1.0 - 0.02 * np.clip((tm - 0.3) / 0.06, 0.0, 1.0))
    osc = square(f, pw=0.28) + 0.5 * saw(f) + 0.5 * (square(f * 1.26, pw=0.3) + 0.4 * saw(f * 1.26))
    osc = osc * (1.0 - 0.15 * (0.5 + 0.5 * np.sin(TAU * 70.0 * tm)))               # reed rattle
    tone = 1.0 * bp(osc, 1250.0, 4.0) + 0.7 * bp(osc, 2700.0, 5.0) + 0.3 * bp(osc, 3600.0, 6.0) + 0.15 * osc
    tone = svf(tone, points(m, [(0.0, 500.0), (0.04, 5000.0), (0.36, 5000.0)], "exp"), 0.8, "lp")   # 'm' -> 'ee'
    tone = tone * points(m, [(0.0, 0.2), (0.02, 1.0), (0.335, 1.0), (0.348, 0.0), (0.36, 0.0)], "cos")
    x = np.zeros(n)
    put(x, norm(tone), 0.0, 1.0)
    put(x, click(rng, 0.8, 2000.0), 0.336, 0.12)                                    # the 'p'
    x = reverb(x, rng, t60=0.2, mix_=0.2, lo=400.0, hi=6000.0)
    return master(x, drive=1.6, lofi_sr=28000, bits=12)
