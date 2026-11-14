"""Player weapons: gunfire, mechanical handling foley, casings and melee.

Gunshot recipe (all four classes share it, with very different numbers):
  1. 1-3 ms broadband click transient
  2. multi-band noise body (high bands decay fastest) + a resonant 'voice' band
  3. low sine thump sweeping down (the chest punch)
  4. mechanical action clack(s) 20-80 ms later
  5. early reflections (multi-tap) and a short diffuse tail
  -> tanh saturation, lo-fi band-limit, hard limiter.
"""
from __future__ import annotations

from kit import *  # noqa: F401,F403
from registry import sound


# --------------------------------------------------------------------------
# gunfire
# --------------------------------------------------------------------------
@sound("pistol_fire", fade=0.12)
def pistol_fire(rng, j, v):
    """Sharp semi-auto crack: bright 2 kHz voice, short punch, slide clack-clack."""
    n = ns(j(0.58, 0.04))
    body = multiband(n, rng, [
        (3200.0, 12000.0, j(0.007), 1.3),
        (900.0, 3400.0, j(0.020), 1.0),
        (220.0, 950.0, j(0.036), 0.7),
    ])
    body += 0.6 * res_burst(n, rng, j(2150.0), 2.4, j(0.015))
    th = thump(n, j(230.0), j(85.0), 0.015, j(0.032), h2=0.15)
    dry = body + 0.5 * th
    x = dry.copy()
    put(x, click(rng, 1.5, 2500.0), 0.0, 1.2)
    # slide: hits the rear stop, then slams home
    put(x, clack(rng, 0.05, body=j(620.0), ring=j.each((2300.0, 3900.0, 5700.0)), ring_tau=0.007), j(0.038), 0.20)
    put(x, clack(rng, 0.07, body=j(520.0), ring=j.each((2050.0, 3300.0, 5100.0)), ring_tau=0.012, weight=1.3),
        j(0.079), 0.27)
    x += taps(dry, [(j(0.017), 0.24, 5000.0), (j(0.031), -0.17, 4000.0), (j(0.053), 0.13, 3000.0),
                    (j(0.086), -0.09, 2400.0)], dry=0.0)
    x += 0.38 * rumble(n, rng, 250.0, 3800.0, j(0.11), attack=0.012, roll_hz=14.0, roll=0.35)
    return master(x, drive=2.8, low_db=1.5, lofi_sr=32000)


@sound("rifle_fire", fade=0.10)
def rifle_fire(rng, j, v):
    """Auto rifle: tight, mid-focused bark that is gone in ~180 ms so 10 shots/s stay clean."""
    n = ns(j(0.38, 0.03))
    body = multiband(n, rng, [
        (2600.0, 9500.0, j(0.0045), 0.8),
        (600.0, 2700.0, j(0.013), 1.0),
        (180.0, 650.0, j(0.019), 0.55),
    ])
    body += 0.8 * res_burst(n, rng, j(1250.0), 2.2, j(0.013))
    th = thump(n, j(190.0), j(75.0), 0.012, j(0.022), h2=0.12)
    dry = body + 0.38 * th
    x = dry.copy()
    put(x, click(rng, 1.2, 2000.0), 0.0, 1.1)
    # bolt carrier cycling
    put(x, clack(rng, 0.04, body=j(700.0), ring=j.each((1700.0, 2900.0, 4300.0)), ring_tau=0.006), j(0.024), 0.17)
    put(x, clack(rng, 0.04, body=j(560.0), ring=j.each((1500.0, 2600.0, 4000.0)), ring_tau=0.007, weight=1.2),
        j(0.052), 0.14)
    x += taps(dry, [(j(0.013), 0.18, 4500.0), (j(0.027), -0.10, 3200.0)], dry=0.0)
    x += 0.07 * rumble(n, rng, 300.0, 3000.0, j(0.040), attack=0.008, roll=0.0)
    return master(x, drive=3.0, low_db=1.0, lofi_sr=32000)


@sound("shotgun_fire", fade=0.30)
def shotgun_fire(rng, j, v):
    """Pump shotgun: huge low body, wide crunchy blast, the longest boom of the set."""
    n = ns(j(1.15, 0.04))
    body = multiband(n, rng, [
        (2500.0, 9000.0, j(0.010), 1.0),
        (500.0, 2500.0, j(0.040), 1.3),
        (120.0, 500.0, j(0.085), 1.1),
        (35.0, 160.0, j(0.14), 0.5, 0.004),
    ])
    th = thump(n, j(125.0), j(42.0), 0.05, j(0.12), h2=0.2)
    dry = body + 0.5 * th
    x = dry.copy()
    put(x, click(rng, 2.5, 1200.0), 0.0, 1.0)
    # shot column / wad: a few ms of ragged crackle on top of the blast
    put(x, crackle(ns(0.03), rng, rate=1500.0, tau=0.0007, hp_fc=1500.0), 0.002, 0.4)
    x += taps(dry, [(j(0.029), 0.25, 3000.0), (j(0.061), -0.20, 2400.0), (j(0.113), 0.15, 1800.0),
                    (j(0.190), -0.10, 1300.0)], dry=0.0)
    x += 0.26 * rumble(n, rng, 110.0, 2200.0, j(0.23), attack=0.025, roll_hz=7.0, roll=0.45)
    return master(x, drive=3.0, low_db=2.5, lofi_sr=32000)


@sound("sniper_fire", fade=0.45)
def sniper_fire(rng, j, v):
    """High-power rifle: supersonic crack up front, heavy blast, long rolling outdoor tail."""
    n = ns(j(1.9, 0.04))
    # supersonic N-wave: two opposed ultra-short spikes and a 2 ms sizzle of top end
    crack = np.zeros(ns(0.02))
    crack[0], crack[10] = 1.0, -0.85
    crack = bhp(crack, 3000.0, 2) + 0.9 * burst(len(crack), rng, 4000.0, 15000.0, 0.0022)
    m = ns(0.6)
    blast = multiband(m, rng, [
        (2400.0, 10000.0, j(0.009), 0.9),
        (400.0, 2400.0, j(0.030), 1.0),
        (120.0, 500.0, j(0.070), 0.8),
    ])
    blast += 0.5 * res_burst(m, rng, j(700.0), 1.8, j(0.035))
    dry = blast + 0.42 * thump(m, j(150.0), j(50.0), 0.035, j(0.07), h2=0.18)
    x = np.zeros(n)
    put(x, crack, 0.0, 1.5)
    put(x, dry, 0.004, 1.0)            # muzzle blast lands just behind the crack
    # distant terrain slaps: each one later, darker and more smeared into the tail
    for t, g, fc, sm in [(0.13, 0.17, 2400.0, 0.06), (0.27, 0.14, 1700.0, 0.10), (0.52, 0.10, 1250.0, 0.16),
                         (0.71, 0.07, 950.0, 0.20)]:
        put(x, smear(lp(pad(dry, m + ns(sm)), fc), rng, sm, 120.0, fc), j(t, 0.08), g)
    x += 0.40 * rumble(n, rng, 90.0, 2600.0, j(0.55), attack=0.05, roll_hz=4.0, roll=0.6)
    x += 0.06 * rumble(n, rng, 2000.0, 6000.0, j(0.12), attack=0.01, roll=0.0)
    return master(x, drive=2.8, low_db=1.5, lofi_sr=32000)


@sound("zap_fire", fade=0.10)
def zap_fire(rng, j, v):
    """Elemental shot layer: bright 'pzzew' down-sweep with sizzle, a body thump and sparks."""
    n = ns(j(0.40, 0.04))
    t = tt(n)
    f = exp_sweep(n, j(4600.0), j(600.0), j(0.055))
    tone = saw(f) + 0.6 * square(f * 1.498, pw=0.3)
    tone = svf(tone, f * 1.25, 1.6, "bp") + 0.6 * bhp(tone, 300.0, 2)
    tone *= ad_env(n, 0.001, j(0.075))
    sizzle = bbp(white(n, rng) * sine(f * 2.7), 3000.0, 11000.0) * ad_env(n, 0.0, j(0.06))
    body = thump(n, j(240.0), j(80.0), 0.03, j(0.045), h2=0.2) + 0.45 * burst(n, rng, 300.0, 1300.0, j(0.025))
    ring = sine(exp_sweep(n, 640.0, 470.0, 0.1)) * (0.6 + 0.4 * np.sin(TAU * 46.0 * t)) * ad_env(n, 0.02, j(0.07))
    x = 0.8 * norm(tone) + 0.6 * norm(sizzle) + 0.6 * body + 0.10 * ring
    put(x, click(rng, 1.0, 4000.0), 0.0, 0.6)
    put(x, crackle(ns(0.2), rng, rate=120.0, tau=0.0005, hp_fc=3000.0, env=exp_env(ns(0.2), 0.08)), 0.06, 0.15)
    x = reverb(x, rng, t60=0.22, mix_=0.35, lo=300.0, hi=8000.0)
    return master(x, drive=1.8, low_db=1.0, lofi_sr=32000, bits=12)


@sound("dry_fire", fade=0.03)
def dry_fire(rng, j, v):
    """Empty click: striker falls on nothing, a little spring tick after it."""
    n = ns(0.11)
    x = np.zeros(n)
    put(x, clack(rng, 0.06, body=720.0, ring=(2600.0, 4100.0, 6300.0), ring_tau=0.006, body_tau=0.008, weight=0.8), 0.0, 1.0)
    put(x, clack(rng, 0.04, body=1100.0, ring=(3300.0, 5200.0), ring_tau=0.004, weight=0.4, bright=0.7), 0.019, 0.3)
    return master(room(x, rng, 0.006, 0.1), drive=1.4, lofi_sr=32000)


# --------------------------------------------------------------------------
# reload / action foley
# --------------------------------------------------------------------------
def _spring(rng, f: float, dur: float = 0.08, fb: float = 0.9) -> np.ndarray:
    """Spring twang: a comb-filtered noise tick (the 'sproing' inside the action)."""
    n = ns(dur)
    return norm(comb(burst(n, rng, 600.0, 4000.0, 0.003), 1.0 / f, fb, damp=3000.0))


def _foley_master(x, rng, drive: float = 1.7):
    return master(room(x, rng, 0.007, 0.12), drive=drive, low_db=1.5, lofi_sr=32000)


@sound("mag_out", fade=0.04)
def mag_out(rng, j, v):
    """Release click, magazine sliding out of the well, hollow pop as it clears."""
    n = ns(j(0.22, 0.03))
    x = np.zeros(n)
    put(x, clack(rng, 0.03, body=j(900.0), ring=j.each((2600.0, 4300.0)), ring_tau=0.004, bright=0.8, weight=0.5), 0.0, 0.5)
    sl_n = ns(0.11)
    put(x, scrape(sl_n, rng, j(2600.0), j(1300.0), q=1.4, rough=0.6, rough_hz=160.0,
                  env=bell_env(sl_n, 0.35, 1.2, 1.5, 0.1)), 0.018, 0.45)
    t_pop = j(0.125, 0.03)
    put(x, knock(ns(0.06), j(340.0), 0.018), t_pop, 0.8)
    put(x, clack(rng, 0.05, body=j(520.0), ring=j.each((1500.0, 2700.0)), ring_tau=0.008, bright=0.6), t_pop, 0.45)
    put(x, crackle(ns(0.05), rng, rate=260.0, tau=0.0008, hp_fc=1800.0), t_pop + 0.012, 0.12)
    return _foley_master(x, rng)


@sound("mag_in", fade=0.05)
def mag_in(rng, j, v):
    """Magazine guided into the well and seated with a solid clack plus latch click."""
    n = ns(j(0.24, 0.03))
    x = np.zeros(n)
    put(x, clack(rng, 0.03, body=j(800.0), ring=j.each((2200.0, 3700.0)), ring_tau=0.004, bright=0.7, weight=0.5), 0.0, 0.35)
    sl_n = ns(0.10)
    put(x, scrape(sl_n, rng, j(1100.0), j(2800.0), q=1.5, rough=0.55, rough_hz=150.0,
                  env=bell_env(sl_n, 0.7, 1.0, 1.0, 0.1)), 0.004, 0.40)
    t_seat = j(0.105, 0.03)
    put(x, clack(rng, 0.09, body=j(260.0), ring=j.each((1700.0, 2900.0, 4400.0)), ring_tau=0.012, body_tau=0.03,
                 weight=1.6), t_seat, 1.0)
    put(x, thump(ns(0.1), j(170.0), j(110.0), 0.01, 0.025), t_seat, 0.7)
    put(x, clack(rng, 0.03, body=1000.0, ring=j.each((3100.0, 5000.0)), ring_tau=0.004, weight=0.4), t_seat + 0.014, 0.4)
    return _foley_master(x, rng, 1.9)


@sound("mag_tap", fade=0.03)
def mag_tap(rng, j, v):
    """Palm slap on the magazine base: dull thud with a small rattle."""
    n = ns(0.10)
    x = 0.6 * thump(n, 230.0, 130.0, 0.01, 0.016)
    x += 0.9 * burst(n, rng, 200.0, 1800.0, 0.009, attack=0.0012)
    put(x, clack(rng, 0.03, body=600.0, ring=(1900.0, 3100.0), ring_tau=0.004, bright=0.5, weight=0.6), 0.006, 0.3)
    return _foley_master(x, rng, 1.8)


@sound("slide_back", fade=0.04)
def slide_back(rng, j, v):
    """Pistol slide racked back: grab tick, bright steel scrape with spring, rear stop."""
    n = ns(0.16)
    x = np.zeros(n)
    put(x, clack(rng, 0.02, body=1200.0, ring=(3000.0, 4800.0), ring_tau=0.003, weight=0.3, bright=0.6), 0.0, 0.3)
    sl_n = ns(0.098)
    put(x, scrape(sl_n, rng, 2200.0, 4200.0, q=1.8, rough=0.45, rough_hz=220.0,
                  env=bell_env(sl_n, 0.75, 1.0, 0.8, 0.12)), 0.003, 0.55)
    put(x, _spring(rng, 760.0, 0.09, 0.86), 0.01, 0.10)
    put(x, clack(rng, 0.05, body=700.0, ring=(2500.0, 4100.0, 6000.0), ring_tau=0.008, weight=1.0), 0.101, 0.9)
    return _foley_master(x, rng)


@sound("slide_release", fade=0.05)
def slide_release(rng, j, v):
    """Pistol slide snapping forward into battery: quick zip, hard ringing clack."""
    n = ns(0.14)
    x = np.zeros(n)
    put(x, clack(rng, 0.02, body=1300.0, ring=(3400.0, 5600.0), ring_tau=0.003, weight=0.3), 0.0, 0.35)
    sl_n = ns(0.028)
    put(x, scrape(sl_n, rng, 4000.0, 2400.0, q=1.6, rough=0.3, env=bell_env(sl_n, 0.6, 1.0, 0.7, 0.2)), 0.004, 0.4)
    put(x, clack(rng, 0.10, body=480.0, ring=(2200.0, 3600.0, 5400.0), ring_tau=0.016, body_tau=0.02, weight=1.5), 0.032, 1.0)
    put(x, modal(ns(0.1), [3100.0, 3172.0], [0.03, 0.026], [0.5, 0.4], rng=rng), 0.033, 0.15)
    return _foley_master(x, rng, 2.0)


@sound("bolt_back", fade=0.05)
def bolt_back(rng, j, v):
    """Rifle charging handle pulled: ratchety scrape against the spring, rear clunk."""
    n = ns(0.22)
    x = np.zeros(n)
    put(x, clack(rng, 0.025, body=900.0, ring=(2300.0, 3700.0), ring_tau=0.004, weight=0.5, bright=0.7), 0.0, 0.4)
    sl_n = ns(0.12)
    put(x, scrape(sl_n, rng, 1500.0, 2600.0, q=1.5, rough=0.8, rough_hz=60.0,
                  env=bell_env(sl_n, 0.7, 0.8, 0.8, 0.15)), 0.004, 0.55)
    put(x, _spring(rng, 430.0, 0.12, 0.9), 0.02, 0.12)
    put(x, clack(rng, 0.07, body=300.0, ring=(1500.0, 2500.0, 3900.0), ring_tau=0.012, body_tau=0.02, weight=1.6), 0.125, 0.95)
    return _foley_master(x, rng)


@sound("bolt_forward", fade=0.05)
def bolt_forward(rng, j, v):
    """Charging handle released: bolt slams home, buffer spring twangs, parts rattle."""
    n = ns(0.16)
    x = np.zeros(n)
    put(x, clack(rng, 0.02, body=1100.0, ring=(2800.0, 4500.0), ring_tau=0.003, weight=0.3, bright=0.6), 0.0, 0.3)
    sl_n = ns(0.035)
    put(x, scrape(sl_n, rng, 2800.0, 1600.0, q=1.4, rough=0.4, env=bell_env(sl_n, 0.6, 1.0, 0.7, 0.2)), 0.004, 0.4)
    put(x, clack(rng, 0.11, body=240.0, ring=(1300.0, 2200.0, 3600.0), ring_tau=0.018, body_tau=0.03, weight=2.0), 0.040, 1.0)
    put(x, _spring(rng, 420.0, 0.09, 0.93), 0.042, 0.18)
    put(x, crackle(ns(0.06), rng, rate=300.0, tau=0.0008, hp_fc=1500.0), 0.06, 0.10)
    return _foley_master(x, rng, 2.0)


@sound("bolt_up", fade=0.03)
def bolt_up(rng, j, v):
    """Bolt-action 1/4: handle lifted - bright cam click, short squeaky turn, stop tick."""
    n = ns(0.12)
    x = np.zeros(n)
    put(x, clack(rng, 0.04, body=800.0, ring=(2900.0, 4600.0, 6800.0), ring_tau=0.006, weight=0.6), 0.0, 0.9)
    sl_n = ns(0.06)
    put(x, scrape(sl_n, rng, 3000.0, 3800.0, q=3.0, rough=0.4, rough_hz=300.0, wide=0.1,
                  env=bell_env(sl_n, 0.4, 0.8, 1.0, 0.1)), 0.008, 0.3)
    put(x, clack(rng, 0.03, body=950.0, ring=(2400.0, 3900.0), ring_tau=0.005, weight=0.5), 0.075, 0.4)
    return _foley_master(x, rng)


@sound("bolt_pull", fade=0.04)
def bolt_pull(rng, j, v):
    """Bolt-action 2/4: bolt drawn back - long falling scrape, rear clunk, case pings away."""
    n = ns(0.19)
    x = np.zeros(n)
    sl_n = ns(0.115)
    put(x, scrape(sl_n, rng, 2600.0, 1300.0, q=1.8, rough=0.4, rough_hz=200.0,
                  env=bell_env(sl_n, 0.5, 0.6, 0.8, 0.2)), 0.0, 0.6)
    put(x, clack(rng, 0.02, body=1000.0, ring=(2700.0,), ring_tau=0.003, weight=0.3, bright=0.5), 0.0, 0.25)
    put(x, clack(rng, 0.05, body=380.0, ring=(1700.0, 2800.0), ring_tau=0.009, body_tau=0.018, weight=1.4), 0.118, 0.9)
    put(x, ping(ns(0.04), rng, 5200.0, 0.02), 0.126, 0.12)
    return _foley_master(x, rng)


@sound("bolt_push", fade=0.04)
def bolt_push(rng, j, v):
    """Bolt-action 3/4: bolt driven forward - rising scrape, soft chambering thunk."""
    n = ns(0.18)
    x = np.zeros(n)
    sl_n = ns(0.105)
    put(x, scrape(sl_n, rng, 1300.0, 2800.0, q=1.8, rough=0.4, rough_hz=200.0,
                  env=bell_env(sl_n, 0.6, 0.6, 0.8, 0.2)), 0.0, 0.6)
    put(x, clack(rng, 0.02, body=900.0, ring=(2300.0,), ring_tau=0.003, weight=0.3, bright=0.5), 0.0, 0.25)
    put(x, clack(rng, 0.05, body=300.0, ring=(1500.0, 2400.0), ring_tau=0.008, body_tau=0.02, weight=1.6, bright=0.6), 0.110, 0.85)
    return _foley_master(x, rng)


@sound("bolt_down", fade=0.03)
def bolt_down(rng, j, v):
    """Bolt-action 4/4: handle slapped down - heavy double clack as the lugs lock."""
    n = ns(0.11)
    x = np.zeros(n)
    put(x, clack(rng, 0.07, body=420.0, ring=(1900.0, 3100.0, 4700.0), ring_tau=0.012, body_tau=0.02, weight=1.8), 0.0, 1.0)
    put(x, clack(rng, 0.05, body=330.0, ring=(1500.0, 2600.0), ring_tau=0.009, weight=1.4, bright=0.7), 0.022, 0.55)
    return _foley_master(x, rng, 2.0)


@sound("pump_back", fade=0.04)
def pump_back(rng, j, v):
    """Shotgun pump, first half ('ch'): hollow fore-end scrape down the tube, rear clack."""
    n = ns(0.19)
    x = np.zeros(n)
    put(x, clack(rng, 0.02, body=700.0, ring=(1900.0, 3000.0), ring_tau=0.004, weight=0.5, bright=0.6), 0.0, 0.35)
    sl_n = ns(0.095)
    put(x, scrape(sl_n, rng, 1800.0, 900.0, q=1.2, rough=0.7, rough_hz=90.0, wide=0.4,
                  env=bell_env(sl_n, 0.5, 0.7, 0.8, 0.2)), 0.003, 0.6)
    put(x, clack(rng, 0.06, body=280.0, ring=(1300.0, 2100.0, 3400.0), ring_tau=0.010, body_tau=0.02, weight=1.5), 0.100, 0.9)
    return _foley_master(x, rng, 1.9)


@sound("pump_forward", fade=0.04)
def pump_forward(rng, j, v):
    """Shotgun pump, second half ('chk'): quick rising scrape, heavy lock-up, bolt click."""
    n = ns(0.18)
    x = np.zeros(n)
    sl_n = ns(0.07)
    put(x, scrape(sl_n, rng, 900.0, 2000.0, q=1.2, rough=0.7, rough_hz=90.0, wide=0.4,
                  env=bell_env(sl_n, 0.6, 0.6, 0.8, 0.2)), 0.0, 0.55)
    put(x, clack(rng, 0.02, body=650.0, ring=(1700.0,), ring_tau=0.003, weight=0.4, bright=0.5), 0.0, 0.25)
    put(x, clack(rng, 0.08, body=240.0, ring=(1500.0, 2500.0, 4000.0), ring_tau=0.014, body_tau=0.025, weight=1.8), 0.075, 1.0)
    put(x, clack(rng, 0.03, body=900.0, ring=(2800.0, 4400.0), ring_tau=0.004, weight=0.4), 0.091, 0.35)
    return _foley_master(x, rng, 2.0)


@sound("shell_insert", fade=0.04)
def shell_insert(rng, j, v):
    """Shell thumbed into the tube: plastic scrape, spring-loaded click past the catch."""
    n = ns(j(0.15, 0.04))
    x = np.zeros(n)
    put(x, knock(ns(0.02), j(900.0), 0.004), 0.0, 0.4)
    sl_n = ns(0.055)
    put(x, scrape(sl_n, rng, j(700.0), j(1400.0), q=1.4, rough=0.5, rough_hz=120.0, wide=0.3,
                  env=bell_env(sl_n, 0.6, 0.7, 0.9, 0.2)), 0.002, 0.45)
    t_c = j(0.060, 0.04)
    put(x, clack(rng, 0.04, body=j(520.0), ring=j.each((2100.0, 3300.0)), ring_tau=0.007, weight=1.2), t_c, 0.9)
    put(x, knock(ns(0.06), j(430.0), 0.02), t_c, 0.5)
    put(x, _spring(rng, j(260.0), 0.07, 0.9), t_c + 0.002, 0.12)
    return _foley_master(x, rng)


@sound("cloth", fade=0.07)
def cloth(rng, j, v):
    """Soft gear / sleeve rustle for weapon handling."""
    n = ns(j(0.25, 0.12))
    x = rustle(n, rng, 400.0, j(4800.0), bumps=3) + 0.4 * rustle(n, rng, 150.0, 900.0, bumps=2, grain_hz=40.0)
    return master(x, drive=1.2, hp_fc=110.0, high_db=-2.0, lofi_sr=32000)


@sound("weapon_draw", fade=0.06)
def weapon_draw(rng, j, v):
    """Weapon brought up: cloth swish, sling rattle, hands settling on the grip."""
    n = ns(0.33)
    x = np.zeros(n)
    put(x, rustle(ns(0.21), rng, 500.0, 5000.0, bumps=2, floor=0.12), 0.0, 0.5)
    put(x, whoosh(ns(0.19), rng, 600.0, 1800.0, 900.0, q=1.2, peak_pos=0.55, floor=0.1), 0.01, 0.35)
    for t, g in [(0.09, 0.14), (0.15, 0.2), (0.19, 0.12)]:
        put(x, clack(rng, 0.025, body=1100.0, ring=(2700.0, 4300.0), ring_tau=0.004, weight=0.4, bright=0.7), t, g)
    put(x, clack(rng, 0.07, body=380.0, ring=(1800.0, 3000.0), ring_tau=0.009, body_tau=0.02, weight=1.3), 0.232, 0.8)
    put(x, clack(rng, 0.03, body=900.0, ring=(2500.0, 4000.0), ring_tau=0.004, weight=0.4), 0.262, 0.3)
    return _foley_master(x, rng, 1.6)


@sound("weapon_holster", fade=0.06)
def weapon_holster(rng, j, v):
    """Weapon stowed: sliding into the holster, soft thud, retention snap."""
    n = ns(0.28)
    x = np.zeros(n)
    sl_n = ns(0.13)
    put(x, scrape(sl_n, rng, 1600.0, 700.0, q=1.0, rough=0.6, rough_hz=80.0, wide=0.4,
                  env=bell_env(sl_n, 0.4, 0.8, 1.0, 0.15)), 0.0, 0.5)
    put(x, rustle(ns(0.2), rng, 400.0, 4500.0, bumps=2, floor=0.1), 0.0, 0.4)
    put(x, knock(ns(0.09), 170.0, 0.03), 0.14, 0.8)
    put(x, burst(ns(0.06), rng, 150.0, 1200.0, 0.012, attack=0.002), 0.14, 0.4)
    put(x, clack(rng, 0.03, body=850.0, ring=(2300.0, 3800.0), ring_tau=0.005, weight=0.6), 0.192, 0.35)
    return _foley_master(x, rng, 1.6)


@sound("ads_in", fade=0.05)
def ads_in(rng, j, v):
    """Aim down sights (subtle): small rising air/cloth move, gear tick, weight settling."""
    n = ns(0.16)
    x = 0.5 * whoosh(n, rng, 800.0, 2400.0, 1800.0, q=1.2, peak_pos=0.33, floor=0.1, air=0.15)
    x += 0.3 * rustle(n, rng, 500.0, 4500.0, bumps=2, floor=0.1)
    put(x, clack(rng, 0.025, body=1000.0, ring=(2600.0, 4200.0), ring_tau=0.004, weight=0.5, bright=0.6), 0.048, 0.22)
    put(x, knock(ns(0.06), 150.0, 0.014), 0.052, 0.25)
    return master(x, drive=1.3, hp_fc=90.0, lofi_sr=32000)


@sound("ads_out", fade=0.05)
def ads_out(rng, j, v):
    """Leave sights (subtle): falling air/cloth move with an early gear tick."""
    n = ns(0.15)
    x = 0.5 * whoosh(n, rng, 2200.0, 1500.0, 700.0, q=1.2, peak_pos=0.3, floor=0.1, air=0.15)
    x += 0.3 * rustle(n, rng, 400.0, 4000.0, bumps=2, floor=0.1)
    put(x, clack(rng, 0.025, body=900.0, ring=(2300.0, 3800.0), ring_tau=0.004, weight=0.5, bright=0.6), 0.025, 0.22)
    return master(x, drive=1.3, hp_fc=90.0, lofi_sr=32000)


# --------------------------------------------------------------------------
# casings
# --------------------------------------------------------------------------
@sound("shell_casing", fade=0.08)
def shell_casing(rng, j, v):
    """Brass casing tinkling on concrete: shrinking bounces, each pinging a different mode."""
    n = ns(j(0.40, 0.06))
    x = np.zeros(n)
    t, gap, g = 0.0, j(0.088, 0.12), 1.0
    modes = [j(3100.0), j(4250.0), j(5350.0)]
    k = 0
    while t < 0.30 and gap > 0.006:
        f = modes[int(rng.integers(0, 3))] * rng.uniform(0.97, 1.03)
        tau = 0.030 * (0.8**k) + 0.008
        put(x, ping(ns(0.12), rng, f, tau, partials=((1.0, 1.0), (1.51, 0.5), (2.76, 0.45), (3.4, 0.2))), t, g)
        put(x, click(rng, 1.0, 2500.0), t, 0.5 * g)
        put(x, burst(ns(0.01), rng, 1500.0, 7000.0, 0.002), t, 0.4 * g)
        t += gap
        gap *= rng.uniform(0.56, 0.68)
        g *= rng.uniform(0.62, 0.8)
        k += 1
    # final roll: a rattle of micro-bounces ringing the case
    rl = ns(0.09)
    roll = bp(crackle(rl, rng, rate=420.0, tau=0.0005, hp_fc=2000.0, env=exp_env(rl, 0.035)), modes[1], 9.0)
    put(x, norm(roll), t, 0.22 * max(g, 0.3))
    return master(room(x, rng, 0.006, 0.1, lp_fc=7000.0), drive=1.3, lofi_sr=32000)


@sound("shell_shotgun", fade=0.06)
def shell_shotgun(rng, j, v):
    """Plastic shotgun hull bouncing: dull hollow 'tok's with the odd brass-base tick."""
    n = ns(j(0.30, 0.06))
    x = np.zeros(n)
    t, gap, g = 0.0, j(0.10, 0.1), 1.0
    k = 0
    while t < 0.23 and gap > 0.01:
        f = j(1050.0) * (0.82 if k % 2 else 1.0) * rng.uniform(0.95, 1.05)
        put(x, knock(ns(0.05), f, 0.009, h=0.45), t, g)
        put(x, burst(ns(0.012), rng, 600.0, 3500.0, 0.003), t, 0.5 * g)
        if k % 2 == 0:
            put(x, ping(ns(0.04), rng, j(3800.0), 0.008), t + 0.001, 0.25 * g)
        t += gap
        gap *= rng.uniform(0.55, 0.66)
        g *= rng.uniform(0.6, 0.75)
        k += 1
    return master(room(x, rng, 0.006, 0.1), drive=1.5, lofi_sr=32000)


# --------------------------------------------------------------------------
# melee
# --------------------------------------------------------------------------
@sound("melee_swing", fade=0.06)
def melee_swing(rng, j, v):
    """Fast swing whoosh with a low 'weight' layer underneath."""
    n = ns(j(0.25, 0.05))
    x = whoosh(n, rng, j(500.0), j(2600.0), j(900.0), q=1.5, peak_pos=0.55, rise=2.5, fall=1.5, floor=0.04)
    x += 0.5 * whoosh(n, rng, 150.0, j(520.0), 200.0, q=1.0, peak_pos=0.5, rise=2.0, fall=1.5, air=0.0, floor=0.04)
    return master(x, drive=1.4, hp_fc=80.0, lofi_sr=32000)


@sound("melee_hit", fade=0.08)
def melee_hit(rng, j, v):
    """Meaty metallic thunk: low punch, mid smack, robot-shell clang and a little crunch."""
    n = ns(j(0.28, 0.05))
    x = 0.6 * thump(n, j(160.0), j(72.0), 0.02, j(0.04), h2=0.2)
    x += 1.0 * burst(n, rng, 250.0, 1800.0, j(0.02), attack=0.0008)
    put(x, click(rng, 1.5, 1500.0), 0.0, 0.7)
    x += 0.6 * ping(n, rng, j(640.0), j(0.07), partials=PLATE, detune=0.02)
    x += 0.35 * ping(n, rng, j(1730.0), j(0.04), partials=PLATE, detune=0.02)
    put(x, crackle(ns(0.06), rng, rate=500.0, tau=0.0008, hp_fc=1500.0, env=exp_env(ns(0.06), 0.02)), 0.004, 0.25)
    return master(room(x, rng, 0.01, 0.15), drive=2.4, low_db=2.0, lofi_sr=32000)
