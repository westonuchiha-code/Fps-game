"""MonoMart robots: energy weapons, servos, footfalls, chirps, deaths and the courier drone.

Enemy weapons are pulse/triangle 'pew's with a resonant formant sweep (rounder
and hollower than the player's noise-based guns and saw-based ZAPP! layer), so
incoming fire is easy to tell from your own.
"""
from __future__ import annotations

from kit import *  # noqa: F401,F403
from registry import sound

ROBOT_SR = 28000


# --------------------------------------------------------------------------
# weapons
# --------------------------------------------------------------------------
@sound("enemy_blaster", fade=0.09)
def enemy_blaster(rng, j, v):
    """Associate energy rifle: hollow pulse 'pew' with a formant sweep, a body thump and a slap echo."""
    n = ns(j(0.35, 0.05))
    f = exp_sweep(n, j(1500.0), j(260.0), j(0.05))
    osc = square(f, pw=0.25) + 0.5 * tri(f * 0.5)
    tone = (svf(osc, f * 2.2, 4.0, "bp") + 0.4 * osc) * (1.0 + 0.3 * sine(f * 3.37)) * ad_env(n, 0.002, j(0.07))
    x = 0.9 * norm(tone)
    x += 0.8 * thump(n, j(200.0), j(75.0), 0.025, j(0.05), h2=0.2)
    x += 0.4 * burst(n, rng, 1500.0, 7000.0, 0.012)
    put(x, click(rng, 1.0, 2500.0), 0.0, 0.5)
    x = taps(x, [(j(0.06), 0.2, 3000.0), (j(0.11), 0.1, 2000.0)])
    return master(x, drive=2.0, low_db=1.5, lofi_sr=ROBOT_SR, bits=12)


@sound("enemy_heavy_cannon", fade=0.28)
def enemy_heavy_cannon(rng, j, v):
    """Regional Manager cannon: big plasma thump - sub boom and FM growl, tearing air, crackling tail."""
    n = ns(j(1.05, 0.05))
    t = tt(n)
    # weight (saturated together): pitch-dropping boom, FM growl, low rumble
    low = 0.9 * thump(n, j(210.0), j(36.0), 0.07, j(0.22), h2=0.3)
    fc = exp_sweep(n, j(420.0), 60.0, 0.12)
    low += 0.7 * blp(fm(fc, fc * 0.5, 4.0 * np.exp(-t / 0.15)), 1800.0, 2) * ad_env(n, 0.003, j(0.2))
    low += 0.3 * rumble(n, rng, 50.0, 500.0, j(0.3), attack=0.04)
    x = softclip(norm(low), 2.5)
    # discharge (kept out of the saturator so it stays bright): air tearing downwards, crack, mid bark
    tear = svf(white(n, rng), exp_sweep(n, 6000.0, 500.0, 0.08), 1.5, "bp") * ad_env(n, 0.001, j(0.09))
    top = 1.0 * norm(tear) + 0.9 * burst(n, rng, 2000.0, 9000.0, 0.012) + 0.6 * burst(n, rng, 600.0, 2500.0, j(0.03))
    put(top, click(rng, 2.0, 1500.0), 0.0, 0.9)
    x += 0.75 * norm(top)
    x += 0.2 * crackle(n, rng, rate=160.0, tau=0.0006, hp_fc=2500.0, env=exp_env(n, 0.25))
    m = ns(0.3)
    put(x, arc(m, rng, f=j(100.0), bright=2600.0) * exp_env(m, 0.1), 0.05, 0.3)
    x = reverb(x, rng, t60=0.8, mix_=0.6, lo=80.0, hi=4000.0)
    return master(x, drive=1.6, low_db=1.5, lofi_sr=32000)


@sound("enemy_charge", fade=0.035)
def enemy_charge(rng, j, v):
    """Cannon charge-up: whine accelerating from 140 Hz to 2 kHz with quickening tremolo; ends at full tilt."""
    n = ns(1.20)
    u = np.arange(n) / n
    f = 140.0 * (2000.0 / 140.0) ** (u**1.3)
    osc = saw(f) + 0.6 * saw(f * 1.507) + 0.5 * square(f * 2.01, pw=0.3)
    tone = svf(osc, np.minimum(f * 3.0, 9000.0), 2.5, "bp") + 0.3 * osc
    trem = 1.0 - 0.35 * (0.5 + 0.5 * np.sin(TAU * phasor(log_sweep(n, 8.0, 40.0))))
    env = points(n, [(0.0, 0.06), (1.0, 0.85), (1.16, 1.0), (1.2, 1.0)], "exp")
    x = 0.9 * norm(tone * trem) * env
    x += 0.3 * sine(f * 0.5) * env
    x += 0.25 * norm(bhp(white(n, rng), 3000.0, 2)) * u**2
    x += 0.15 * crackle(n, rng, rate=20.0 + 400.0 * u**2, tau=0.0004, hp_fc=4000.0)
    return master(x, drive=1.8, low_db=1.0, lofi_sr=32000)


@sound("drone_shot", fade=0.06)
def drone_shot(rng, j, v):
    """Courier drone stinger: light, quick 'pip-zap'."""
    n = ns(j(0.20, 0.06))
    f = exp_sweep(n, j(3400.0), j(900.0), j(0.022))
    tone = (square(f, pw=0.3) + 0.5 * sine(f * 2.0)) * ad_env(n, 0.001, j(0.035))
    x = 0.9 * norm(svf(tone, f * 1.5, 2.0, "bp") + 0.4 * tone)
    x += 0.4 * thump(n, j(260.0), j(130.0), 0.015, 0.025)
    x += 0.5 * burst(n, rng, 3000.0, 10000.0, 0.008)
    put(x, click(rng, 0.8, 3000.0), 0.0, 0.5)
    x = taps(x, [(j(0.04), 0.15, 4000.0)])
    return master(x, drive=1.6, lofi_sr=30000, bits=12)


# --------------------------------------------------------------------------
# drone loop
# --------------------------------------------------------------------------
@sound("drone_loop")
def drone_loop(rng, j, v):
    """Quad-rotor buzz, 2.000 s loop.

    Four rotors at 178 / 183.5 / 190 / 196.5 Hz (all whole numbers of cycles in
    2 s, so the loop is exactly periodic) beat against each other; rotor wobble,
    motor whine and prop wash are likewise phase-locked to the loop length."""
    n = ns(2.0)
    t = np.arange(n) / SR
    x = np.zeros(n)
    fundamental = np.zeros(n)
    for i, f0 in enumerate((178.0, 183.5, 190.0, 196.5)):
        ph = TAU * f0 * t + 0.6 * np.sin(TAU * (1.0 + 0.5 * i) * t + rng.uniform(0, TAU))
        fundamental += np.sin(ph)
        for k in range(1, 27):
            amp = (1.0 / k**1.05) * (1.5 if k % 2 == 0 else 1.0)       # two-blade props: even harmonics strong
            x += amp * np.sin(k * ph + rng.uniform(0, TAU))
    x *= 1.0 + 0.15 * np.sin(TAU * 13.0 * t)
    for f in (2412.0, 2531.5, 2687.0, 2903.5):                          # ESC / motor whine
        x += 0.12 * np.sin(TAU * f * t + rng.uniform(0, TAU))
    wash = circ_band_noise(n, rng, 1500.0, 8000.0, slope_db_oct=-3.0)
    x += 1.5 * wash * (0.6 + 0.4 * np.abs(fundamental) / 4.0)
    x = loop_apply(x, lambda z: blp(peq(bhp(z, 120.0, 2), 800.0, 1.0, 4.0), 7500.0, 2))
    return asym(norm(x) * 0.9, 1.6, 0.15)


# --------------------------------------------------------------------------
# robot bodies
# --------------------------------------------------------------------------
@sound("robot_servo", fade=0.05)
def robot_servo(rng, j, v):
    """Associate joint servo.  1: reach up, 2: wind down, 3: quick double twitch."""
    n = ns(j(0.28, 0.04))
    x = np.zeros(n)
    body = n - ns(0.035)                                   # leave a little room for the stop click to ring
    if v % 3 == 0:
        put(x, servo(body, rng, j(350.0), j(780.0), shape=(0.25, 0.7), gear=6.0, res=1900.0), 0.0, 1.0)
    elif v % 3 == 1:
        put(x, servo(body, rng, j(420.0), j(760.0), shape=(0.08, 0.3), gear=5.0, res=1600.0), 0.0, 1.0)
    else:
        m = ns(0.10)
        put(x, servo(m, rng, j(500.0), j(880.0), shape=(0.3, 0.6), gear=6.0, res=2100.0), 0.0, 1.0)
        put(x, servo(m, rng, j(450.0), j(820.0), shape=(0.3, 0.6), gear=6.0, res=2100.0), 0.13, 0.8)
    put(x, clack(rng, 0.02, body=1200.0, ring=(2900.0, 4500.0), ring_tau=0.003, weight=0.3, bright=0.6), 0.0, 0.25)
    put(x, clack(rng, 0.02, body=1000.0, ring=(2600.0, 4100.0), ring_tau=0.003, weight=0.3, bright=0.6),
        (0.235 if v % 3 == 2 else n / SR - 0.06), 0.2)
    return master(room(x, rng, 0.006, 0.1), drive=1.6, lofi_sr=ROBOT_SR, bits=12)


@sound("robot_step", fade=0.05)
def robot_step(rng, j, v):
    """Associate footfall: light plastic-and-metal 'tink-thud' with a tiny servo after it."""
    n = ns(j(0.17, 0.06))
    f = j(950.0) * (1.0, 1.1, 0.92)[v % 3]
    x = 0.6 * burst(n, rng, 1000.0, 7000.0, 0.004)
    put(x, click(rng, 1.0, 2000.0), 0.0, 0.6)
    x += 0.7 * ping(n, rng, f, j(0.022), partials=SHELL, detune=0.03)
    x += 0.6 * knock(n, j(190.0), 0.014)
    put(x, servo(ns(0.06), rng, 600.0, 900.0, shape=(0.3, 0.6)), 0.05, 0.14)
    return master(room(x, rng, 0.008, 0.1), drive=1.8, low_db=1.0, lofi_sr=ROBOT_SR, bits=12)


@sound("heavy_step", fade=0.14)
def heavy_step(rng, j, v):
    """Regional Manager stomp: sub thump, plate clank, ground crunch, hydraulic sigh."""
    n = ns(j(0.50, 0.05))
    x = 0.9 * thump(n, j(80.0), j(36.0), 0.04, j(0.10), h2=0.3)
    x += 0.4 * burst(n, rng, 40.0, 160.0, 0.09, attack=0.004)
    x += 1.0 * burst(n, rng, 300.0, 3000.0, j(0.03))
    put(x, click(rng, 2.0, 1000.0), 0.0, 0.8)
    x += 0.5 * ping(n, rng, j(240.0), j(0.09), partials=PLATE, detune=0.03)
    x += 0.3 * ping(n, rng, j(760.0), j(0.05), partials=PLATE, detune=0.03)

    def chip(r):
        return bp(burst(ns(0.015), r, 800.0, 7000.0, r.uniform(0.002, 0.004)), r.uniform(1200.0, 4000.0), 1.5)

    x += scatter(n, rng, 8, 0.05, 0.35, chip, 0.05, 0.2, early=1.3, fall=0.5)
    m = ns(0.25)
    put(x, norm(bhp(white(m, rng), 3000.0, 2)) * ad_env(m, 0.02, 0.08), 0.12, 0.2)
    x = reverb(x, rng, t60=0.5, mix_=0.4, lo=60.0, hi=3000.0)
    return master(x, drive=3.0, low_db=3.0, lofi_sr=32000)


@sound("robot_alert", fade=0.05)
def robot_alert(rng, j, v):
    """Associate spots you: cheerful rising two-tone chirp ('bee-BEEP?') with a vowel-like formant."""
    n = ns(j(0.35, 0.03))
    lo, hi = ((NOTE["A5"], NOTE["E6"]), (NOTE["A5"], NOTE["D6"]))[v % 2]
    x = np.zeros(n)
    for t0, dur, f_from, f_to, fm1, fm2, g in ((0.0, 0.11, lo * 0.8, lo, 1800.0, 2800.0, 0.8),
                                             (0.12, 0.15, hi * 0.84, hi, 2200.0, 3200.0, 1.0)):
        m = ns(dur)
        tm = tt(m)
        f = f_to + (f_from - f_to) * np.exp(-tm / 0.012)
        f = f * (1.0 + 0.012 * np.sin(TAU * 28.0 * tm))                 # robotic warble
        osc = square(f, pw=0.35) + 0.4 * sine(2.0 * f)
        tone = bp(osc, j(fm1), 3.0) + 0.7 * bp(osc, j(fm2), 4.0) + 0.25 * osc
        put(x, norm(tone) * fade(np.ones(m), 0.004, 0.02), t0, g)
        put(x, click(rng, 0.6, 3000.0), t0, 0.2)
    x = reverb(x, rng, t60=0.15, mix_=0.25, lo=500.0, hi=7000.0)
    return master(x, drive=1.6, lofi_sr=24000, bits=10)


@sound("robot_death", fade=0.20)
def robot_death(rng, j, v):
    """Associate destroyed: voice-box glitch, power-down pitch drop, body crunch, sparks."""
    n = ns(j(1.0, 0.08))
    dur = n / SR
    t = tt(n)
    x = np.zeros(n)
    # power-down: oscillator and its filter slide to the floor, tremolo slows with it
    f = exp_sweep(n, j(620.0), 38.0, j(0.28))
    osc = saw(f) + 0.7 * square(f * 0.5, pw=0.3) + 0.3 * sine(f * 3.01)
    down = svf(osc, np.minimum(f * 6.0, 8000.0), 1.0, "lp") * (1.0 - 0.3 * (0.5 + 0.5 * np.sin(TAU * phasor(f / 20.0))))
    x += 0.8 * norm(down) * points(n, [(0.0, 1.0), (0.6 * dur, 0.6), (0.85 * dur, 0.0), (dur, 0.0)], "cos")
    # stuttering voice-box blips
    for i in range(int(rng.integers(3, 6))):
        m = ns(rng.uniform(0.02, 0.045))
        fb = j(1400.0) * 0.8**i
        blip = fm(np.full(m, fb), fb * 0.5, 2.0) * fade(np.ones(m), 0.002, 0.006)
        put(x, bp(blip, 2000.0, 1.5), 0.02 + 0.055 * i + rng.uniform(0.0, 0.01), 0.3)
    put(x, click(rng, 1.2, 2000.0), 0.0, 0.6)
    put(x, burst(ns(0.05), rng, 1500.0, 8000.0, 0.008), 0.0, 0.5)
    # the chassis hits the floor
    t_c = j(0.32, 0.1)
    put(x, clack(rng, 0.25, body=j(180.0), ring=j.each((700.0, 1200.0, 2100.0)), ring_tau=0.03, body_tau=0.04, weight=2.0), t_c, 0.9)
    put(x, burst(ns(0.2), rng, 300.0, 3000.0, 0.04), t_c, 0.7)
    put(x, thump(ns(0.3), 100.0, 45.0, 0.03, 0.08), t_c, 0.8)
    # sparks
    m = ns(0.25)
    put(x, arc(m, rng, f=j(110.0), bright=3300.0) * exp_env(m, 0.09), 0.05, 0.35)
    m = ns(0.15)
    put(x, arc(m, rng, f=j(125.0), bright=3800.0) * exp_env(m, 0.05), j(0.55, 0.1), 0.25)
    x += 0.3 * crackle(n, rng, rate=120.0, tau=0.0005, hp_fc=3500.0, env=np.exp(-t / 0.35))

    def bit(r):
        return ping(ns(0.12), r, 900.0 * 3.5 ** r.uniform(), r.uniform(0.012, 0.03), partials=SHELL, detune=0.03)

    x += scatter(n, rng, 6, t_c + 0.03, 0.8 * dur, bit, 0.1, 0.25, early=1.2)
    x = reverb(x, rng, t60=0.5, mix_=0.4, lo=200.0, hi=6000.0)
    return master(x, drive=2.2, low_db=1.5, lofi_sr=32000, bits=12)


@sound("robot_explode", fade=0.25)
def robot_explode(rng, j, v):
    """Robot bursts apart: sharp mid crack and short boom, scattering metal parts, sparks, a comic spring."""
    n = ns(j(1.05, 0.06))
    x = multiband(n, rng, [(1500.0, 9000.0, j(0.02), 1.0), (300.0, 2000.0, j(0.06), 0.9)])
    put(x, click(rng, 2.0, 1200.0), 0.0, 1.0)
    x += 0.8 * thump(n, j(140.0), j(50.0), 0.04, j(0.12), h2=0.2)
    roar = svf(pink(n, rng), exp_sweep(n, 5000.0, 500.0, 0.12), 0.8, "lp") * ad_env(n, 0.01, 0.15)
    x += 0.7 * softclip(norm(roar), 3.0)

    def part(r):
        f = 400.0 * 6.0 ** r.uniform()
        return ping(ns(0.3), r, f, r.uniform(0.03, 0.1), partials=PLATE if r.uniform() < 0.5 else SHELL, detune=0.03)

    x += scatter(n, rng, 10, 0.08, 0.85, part, 0.15, 0.45, early=1.4, fall=0.4)
    # a bolt bouncing away
    tb, gap, g = j(0.3, 0.2), 0.11, 0.3
    while tb < 0.9 and gap > 0.012:
        put(x, ping(ns(0.06), rng, j(4300.0), 0.012), tb, g)
        tb, gap, g = tb + gap, gap * 0.62, g * 0.7
    m = ns(0.3)
    put(x, arc(m, rng, f=j(115.0), bright=3400.0) * exp_env(m, 0.1), 0.03, 0.3)
    x += 0.25 * crackle(n, rng, rate=140.0, tau=0.0005, hp_fc=3500.0, env=exp_env(n, 0.3))
    # spring 'boing' (Saturday-morning touch, kept low in the mix)
    k = ns(0.35)
    tk = tt(k)
    fb = j((300.0, 240.0)[v % 2]) * (1.0 + 0.5 * np.exp(-tk / 0.05)) * (1.0 + 0.06 * np.sin(TAU * 23.0 * tk))
    put(x, (sine(fb) + 0.5 * sine(fb * 2.71)) * ad_env(k, 0.002, 0.11), j(0.25, 0.1), 0.16)
    x += 0.25 * rumble(n, rng, 80.0, 900.0, j(0.25), attack=0.03)
    x = reverb(x, rng, t60=0.6, mix_=0.5, lo=150.0, hi=5000.0)
    return master(x, drive=2.6, low_db=2.0, lofi_sr=32000)
