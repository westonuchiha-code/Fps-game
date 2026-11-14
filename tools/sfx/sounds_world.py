"""World: ambience beds, the MonoMart PA chime, gates, doors, barrels and glass.

Ambience loops are 10 s long.  The wind is stochastic (rendered long and
equal-power cross-faded, with all gust modulators periodic over the loop); the
warehouse bed is built entirely from loop-periodic parts (whole-cycle hum
partials, FFT-synthesised noise, circularly placed events, tiled reverb).
"""
from __future__ import annotations

from kit import *  # noqa: F401,F403
from registry import sound


# --------------------------------------------------------------------------
# ambience loops
# --------------------------------------------------------------------------
@sound("amb_wind_loop")
def amb_wind_loop(rng, j, v):
    """Gentle desert wind bed, 10.000 s loop: low rush, a soft wandering howl, a trace of sand hiss."""
    n = ns(10.0)
    xf = ns(1.5)
    m = n + xf

    def gust(cycles):
        g = periodic_lfo(n, rng, cycles)                   # periodic over the loop ...
        return np.concatenate([g, g[:xf]])                 # ... so it lines up across the cross-fade

    g1, g2, g3 = gust((1, 2, 3, 5)), gust((1, 3, 4, 7)), gust((2, 3, 5, 8))
    body = svf(pink(m, rng), 260.0 + 240.0 * g1, 0.8, "bp") * (0.55 + 0.45 * g1)
    howl = svf(white(m, rng), 520.0 + 520.0 * g2, 6.0, "bp") * g2**2
    low = bbp(brown(m, rng), 40.0, 160.0) * (0.6 + 0.4 * g1)
    hiss = bhp(white(m, rng), 4000.0, 2) * (0.15 + 0.85 * g3**2)
    x = 1.0 * norm(body) + 0.30 * norm(howl) + 0.45 * norm(low) + 0.06 * norm(hiss)
    x = loop_xfade(x, n)
    return loop_apply(x, lambda z: blp(bhp(z, 30.0, 2), 9000.0, 2))


@sound("amb_warehouse_loop")
def amb_warehouse_loop(rng, j, v):
    """Fulfillment-centre bed, 10.000 s loop: mains hum, air handling, distant conveyors and rollers."""
    n = ns(10.0)
    t = np.arange(n) / SR
    # mains / transformer hum: every partial is a multiple of 0.1 Hz -> whole cycles in 10 s
    hum = np.zeros(n)
    for f, a in ((60.0, 0.5), (119.9, 0.6), (120.1, 0.6), (180.0, 0.35), (239.8, 0.2), (240.3, 0.15), (360.0, 0.12)):
        hum += a * np.sin(TAU * f * t + rng.uniform(0, TAU))
    buzz = np.zeros(n)
    for k in range(15, 41):                                 # fluorescent ballast buzz
        buzz += (1.0 / k) * np.sin(TAU * 120.0 * k * t + rng.uniform(0, TAU))
    # air handling
    hvac = circ_band_noise(n, rng, 60.0, 500.0, slope_db_oct=-3.0) * periodic_lfo(n, rng, (1, 2, 3), 0.8, 1.0)
    air = circ_band_noise(n, rng, 500.0, 2500.0, slope_db_oct=-6.0)
    vent = circ_band_noise(n, rng, 2500.0, 9000.0, slope_db_oct=-6.0)       # a little air on top so the bed is not muffled
    # conveyors: belt rumble pulsing at 6.4 Hz, roller ticks at 12.8 Hz, a belt-splice thump every 1.25 s
    belt = circ_band_noise(n, rng, 120.0, 420.0) * (0.6 + 0.4 * (0.5 + 0.5 * np.sin(TAU * 6.4 * t)) ** 2)
    events = np.zeros(n)
    for i in range(128):
        k = ns(0.02)
        tick = bp(burst(k, rng, 500.0, 4000.0, 0.003), rng.uniform(900.0, 2500.0), 2.0)
        put_wrap(events, tick, i / 12.8 + rng.uniform(-0.004, 0.004), rng.uniform(0.3, 1.0))
    for i in range(8):
        k = ns(0.25)
        splice = thump(k, 90.0, 60.0, 0.02, 0.04) + 0.5 * burst(k, rng, 100.0, 700.0, 0.02, attack=0.003)
        put_wrap(events, splice, 0.4 + i * 1.25, 2.0)
    for t0, f in ((3.7, 420.0), (7.9, 610.0)):              # two very distant clanks for life
        put_wrap(events, lp(ping(ns(1.0), rng, f, 0.25, partials=PLATE, detune=0.03), 1500.0), t0, 1.2)
    far_ir = make_ir(rng, t60=1.3, pre=0.02, lo=200.0, hi=2500.0)
    far = loop_apply(events, lambda z: signal.fftconvolve(z, far_ir)[: len(z)], reps=4)
    whine = 0.6 * np.sin(TAU * 730.0 * t + 1.5 * np.sin(TAU * 0.3 * t)) + 0.3 * np.sin(TAU * 1094.0 * t + np.sin(TAU * 0.2 * t))
    x = (0.5 * norm(hum) + 0.02 * norm(buzz) + 0.5 * hvac * 3.0 + 0.16 * air * 3.0 + 0.28 * belt * 3.0
         + 1.4 * norm(far) + 0.012 * whine + 0.02 * vent * 3.0)
    return np.tanh(1.2 * norm(x))


# --------------------------------------------------------------------------
# one-shots
# --------------------------------------------------------------------------
@sound("pa_chime", fade=0.35)
def pa_chime(rng, j, v):
    """MonoMart PA 'bing-bong-bong': three falling notes of an E major triad (G#5, E5, B4)
    through a honky horn speaker with store slap-back and reverb."""
    n = ns(1.56)
    x = np.zeros(n)
    for t0, name, g in ((0.0, "G#5", 1.0), (0.30, "E5", 0.95), (0.60, "B4", 0.95)):
        m = n - int(t0 * SR)
        tm = tt(m)
        f = NOTE[name]
        tone = (np.sin(TAU * f * tm) + 0.30 * np.sin(TAU * 2.0 * f * tm) * np.exp(-tm / 0.15)
                + 0.12 * np.sin(TAU * 3.0 * f * tm) * np.exp(-tm / 0.08)
                + 0.08 * np.sin(TAU * 4.2 * f * tm) * np.exp(-tm / 0.05))
        put(x, tone * ad_env(m, 0.003, 0.30), t0, g)
        put(x, burst(ns(0.02), rng, 800.0, 4000.0, 0.004), t0, 0.12)        # striker
    put(x, click(rng, 1.0, 1000.0), 0.0, 0.15)                               # PA keys up
    x += 0.004 * bbp(white(n, rng), 300.0, 5000.0)                           # line hiss
    x = softclip(bbp(norm(x), 350.0, 4200.0) * 1.2, 1.5)                     # horn speaker
    x = taps(x, [(0.085, 0.22, 2500.0), (0.17, 0.10, 1800.0)])
    x = reverb(x, rng, t60=0.8, mix_=0.5, lo=300.0, hi=4000.0)
    return master(x, drive=1.3, lofi_sr=24000)


@sound("gate_open", fade=0.16)
def gate_open(rng, j, v):
    """Heavy steel gate grinding open: latch drops, motor and chain take up, long groaning scrape, end-stop clank."""
    n = ns(2.50)
    t = tt(n)
    x = np.zeros(n)
    put(x, clack(rng, 0.2, body=180.0, ring=(700.0, 1150.0, 1900.0), ring_tau=0.03, body_tau=0.04, weight=2.0), 0.0, 0.9)
    put(x, thump(ns(0.3), 110.0, 55.0, 0.03, 0.08), 0.0, 0.7)
    run = points(n, [(0.0, 0.0), (0.10, 0.0), (0.25, 1.0), (1.93, 0.9), (2.07, 0.0), (2.5, 0.0)], "cos")
    # motor + chain
    fm_ = 70.0 + 25.0 * np.clip((t - 0.1) / 0.4, 0.0, 1.0)
    x += 0.35 * norm(blp(saw(fm_) + 0.5 * saw(fm_ * 2.01), 900.0, 2)) * run
    chain = np.zeros(n)
    for i in range(int(1.9 * 17)):
        put(chain, ping(ns(0.03), rng, rng.uniform(1800.0, 2600.0), 0.006) + 0.6 * burst(ns(0.03), rng, 1500.0, 4000.0, 0.002),
            0.12 + i / 17.0 + rng.uniform(-0.006, 0.006), rng.uniform(0.4, 1.0))
    x += 0.25 * norm(chain) * run
    # the grind: rough mid scrape, low resonant groan, intermittent stick-slip squeal
    rough = slow_noise(n, rng, 14.0) ** 1.5
    grind = svf(white(n, rng), 700.0 + 500.0 * slow_noise(n, rng, 3.0), 2.2, "bp") * (0.35 + 0.65 * rough)
    groan = svf(brown(n, rng), 140.0 + 60.0 * slow_noise(n, rng, 2.0), 9.0, "bp") * (0.4 + 0.6 * slow_noise(n, rng, 9.0))
    sq_gate = lp1((slow_noise(n, rng, 5.0) > 0.55).astype(float), 40.0)
    squeal = svf(white(n, rng), 1400.0 + 500.0 * slow_noise(n, rng, 4.0), 30.0, "bp") * sq_gate
    x += (0.9 * norm(grind) + 0.6 * norm(groan) + 0.22 * norm(squeal)) * run
    for i in range(11):                                       # wheels over rail joints
        put(x, thump(ns(0.08), 95.0, 60.0, 0.01, 0.02), 0.3 + i / 6.0, 0.2)
    # end stop
    put(x, clack(rng, 0.40, body=150.0, ring=(600.0, 1000.0, 1700.0), ring_tau=0.05, body_tau=0.05, weight=2.2), 2.05, 1.0)
    put(x, thump(ns(0.40), 90.0, 45.0, 0.04, 0.10), 2.05, 0.9)
    k = ns(0.2)
    put(x, crackle(k, rng, rate=150.0, tau=0.001, hp_fc=800.0, env=exp_env(k, 0.06)), 2.07, 0.2)
    x = reverb(x, rng, t60=0.9, mix_=0.45, lo=80.0, hi=4000.0)
    return master(x, drive=2.4, low_db=2.0, lofi_sr=32000)


@sound("door_open", fade=0.12)
def door_open(rng, j, v):
    """Automatic sliding door: latch click, pneumatic hiss, motor slide, soft end thunk."""
    n = ns(0.70)
    x = np.zeros(n)
    put(x, clack(rng, 0.04, body=600.0, ring=(1900.0, 3100.0), ring_tau=0.006, weight=0.8), 0.0, 0.6)
    m = ns(0.30)
    put(x, norm(bp(bhp(white(m, rng), 2000.0, 2), 5000.0, 0.8) * ad_env(m, 0.008, 0.09)), 0.0, 0.6)
    k = ns(0.42)
    put(x, servo(k, rng, 220.0, 520.0, shape=(0.2, 0.65), gear=5.0, res=1500.0), 0.04, 0.5)
    put(x, norm(bbp(white(k, rng), 150.0, 900.0)) * bell_env(k, 0.4, 1.0, 1.2, 0.05), 0.04, 0.3)
    put(x, clack(rng, 0.10, body=240.0, ring=(900.0, 1500.0, 2400.0), ring_tau=0.015, body_tau=0.025, weight=1.6), 0.50, 0.8)
    put(x, thump(ns(0.12), 120.0, 70.0, 0.02, 0.04), 0.50, 0.5)
    x = reverb(x, rng, t60=0.3, mix_=0.3, lo=200.0, hi=6000.0)
    return master(x, drive=1.8, low_db=1.5, lofi_sr=32000)


DRUM = ((1.0, 1.0), (1.59, 0.8), (2.14, 0.6), (2.30, 0.5), (2.65, 0.4), (2.92, 0.3), (3.5, 0.25), (4.06, 0.2))


@sound("barrel_hit", fade=0.07)
def barrel_hit(rng, j, v):
    """Steel drum struck: hollow cavity 'bong' under a membrane-mode clang."""
    n = ns(j(0.24, 0.06))
    k = (1.0, 0.89)[v % 2]
    x = 0.7 * burst(n, rng, 800.0, 7000.0, 0.004)
    put(x, click(rng, 1.2, 1500.0), 0.0, 0.9)
    x += 0.45 * knock(n, j(135.0) * k, 0.045, drop=1.15, h=0.2)
    x += 0.8 * ping(n, rng, j(215.0) * k, j(0.05), partials=DRUM, detune=0.02)
    x += 0.35 * ping(n, rng, j(1450.0), j(0.025), partials=PLATE, detune=0.03)
    return master(room(x, rng, 0.010, 0.12), drive=2.0, low_db=1.5, lofi_sr=32000)


@sound("glass_break", fade=0.16)
def glass_break(rng, j, v):
    """Pane shattering: bright smash, a dense spray of shard pings, pieces tinkling on the floor."""
    n = ns(j(0.70, 0.06))
    x = multiband(n, rng, [(2500.0, 14000.0, j(0.012), 1.0), (800.0, 4000.0, j(0.02), 0.7)])
    put(x, click(rng, 1.5, 2500.0), 0.0, 1.0)
    x += 0.4 * ping(n, rng, j(1900.0), 0.03, partials=PLATE, detune=0.03)
    x += 0.3 * knock(n, 240.0, 0.012)

    def shard(r, lo=1500.0, hi=11000.0, tmin=0.008, tmax=0.05):
        f = lo * (hi / lo) ** r.uniform()
        return ping(ns(0.15), r, f, r.uniform(tmin, tmax), partials=BAR if r.uniform() < 0.5 else PLATE, detune=0.03)

    x += scatter(n, rng, 34, 0.0, 0.30, shard, 0.1, 0.45, early=2.2, fall=0.4)

    def tinkle(r):
        return shard(r, 3000.0, 9000.0, 0.01, 0.03) + 0.5 * pad(click(r, 0.6, 3000.0), ns(0.15))

    x += scatter(n, rng, 12, 0.25, 0.60, tinkle, 0.05, 0.2, early=1.0, fall=0.5)
    x = reverb(x, rng, t60=0.3, mix_=0.35, lo=500.0, hi=10000.0)
    return master(x, drive=1.6, lofi_sr=32000)
