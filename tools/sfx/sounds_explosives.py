"""Explosions, remote mines and elemental effects (fire / shock / acid).

Explosion recipe: hard click -> broadband crack -> sub boom (sine sweeping down
to ~30 Hz plus sub noise) -> a distorted 'roar' whose low-pass closes over time
-> scattered debris -> rolling rumble tail -> reverb, then heavy saturation.
"""
from __future__ import annotations

from kit import *  # noqa: F401,F403
from registry import sound


def _debris(rng):
    """One piece of falling debris: mostly grit ticks, sometimes a small metal clank."""
    if rng.uniform() < 0.65:
        n = ns(0.02)
        return bp(burst(n, rng, 600.0, 8000.0, rng.uniform(0.002, 0.006)), rng.uniform(900.0, 4500.0), 1.5)
    f = 700.0 * 5.0 ** rng.uniform()
    return ping(ns(0.12), rng, f, rng.uniform(0.012, 0.035), partials=PLATE, detune=0.03)


def _explosion(rng, j, n, *, boom_f, boom_tau, roar_f, roar_tau, debris_n, debris_t, tail_tau, rev_t60, drive):
    f0, f1 = boom_f
    # the weight: sub boom + sub noise + a roar whose low-pass closes, saturated hard together
    low = 0.7 * thump(n, j(f0), j(f1), boom_tau * 0.3, j(boom_tau), attack=0.002, h2=0.25)
    low += 0.35 * burst(n, rng, 25.0, f1 * 3.0, j(boom_tau * 1.1), attack=0.01)
    roar = svf(pink(n, rng), exp_sweep(n, roar_f[0], roar_f[1], j(roar_tau)), 0.8, "lp") * ad_env(n, 0.012, j(roar_tau * 1.3))
    low += 1.2 * norm(roar)
    low += 1.0 * burst(n, rng, 200.0, 1200.0, j(boom_tau * 0.3))
    low += 0.7 * burst(n, rng, 500.0, 3000.0, j(boom_tau * 0.25))
    x = softclip(norm(low), drive)
    # the crack: added after the saturator so the onset stays bright on top of the boom
    crack = multiband(n, rng, [(2500.0, 10000.0, j(0.014), 1.0), (800.0, 6000.0, j(0.028), 0.9)])
    put(crack, click(rng, 3.0, 800.0), 0.0, 1.2)
    x += 1.0 * norm(crack)
    x += scatter(n, rng, debris_n, debris_t[0], debris_t[1], _debris, 0.04, 0.2, early=1.8, fall=0.6)
    x += 0.3 * rumble(n, rng, 60.0, 900.0, j(tail_tau), attack=0.08, roll_hz=5.0, roll=0.5)
    x = reverb(x, rng, t60=rev_t60, mix_=0.9, lo=90.0, hi=3500.0)
    return master(x, drive=1.6, low_db=1.0, lofi_sr=32000)


@sound("explosion_big", fade=0.55)
def explosion_big(rng, j, v):
    """Mine / barrel explosion: deep boom, debris rain, long rolling tail."""
    n = ns(j(2.25, 0.05))
    return _explosion(rng, j, n, boom_f=(95.0, 30.0), boom_tau=0.32, roar_f=(5000.0, 300.0), roar_tau=0.35,
                      debris_n=int(rng.integers(26, 36)), debris_t=(0.15, 1.6), tail_tau=0.7, rev_t60=1.4, drive=2.5)


@sound("explosion_small", fade=0.30)
def explosion_small(rng, j, v):
    """Small blast (grenade-size): tighter, higher boom and a short tail."""
    n = ns(j(1.10, 0.06))
    return _explosion(rng, j, n, boom_f=(130.0, 48.0), boom_tau=0.16, roar_f=(6000.0, 450.0), roar_tau=0.18,
                      debris_n=int(rng.integers(10, 15)), debris_t=(0.10, 0.8), tail_tau=0.3, rev_t60=0.7, drive=2.2)


@sound("mine_throw", fade=0.07)
def mine_throw(rng, j, v):
    """Mine tossed: short whoosh with the flutter of a spinning disc."""
    n = ns(0.25)
    t = tt(n)
    flutter = 1.0 - 0.45 * (0.5 + 0.5 * np.sin(TAU * 32.0 * t))
    x = whoosh(n, rng, 400.0, 1800.0, 700.0, q=1.4, peak_pos=0.45, floor=0.06) * flutter
    x += 0.4 * whoosh(n, rng, 150.0, 450.0, 200.0, q=1.0, peak_pos=0.4, air=0.0, floor=0.06) * flutter
    put(x, rustle(ns(0.08), rng, 500.0, 4000.0, bumps=1, floor=0.2), 0.0, 0.3)
    return master(x, drive=1.4, hp_fc=80.0, lofi_sr=32000)


@sound("mine_stick", fade=0.06)
def mine_stick(rng, j, v):
    """Mine clamps on: magnetic thunk on a ringing surface, then a tiny rising arming chirp."""
    n = ns(j(0.24, 0.04))
    x = 1.0 * thump(n, j(170.0), j(95.0), 0.012, 0.03, h2=0.2)
    put(x, clack(rng, 0.08, body=j(300.0), ring=j.each((1100.0, 1900.0, 3100.0)), ring_tau=0.012, weight=1.4), 0.0, 0.8)
    x += 0.3 * ping(n, rng, j(480.0), 0.05, partials=PLATE, detune=0.03)
    m = ns(0.045)
    f = log_sweep(m, j(1900.0), j(3300.0))
    chirp = (sine(f) + 0.4 * square(f, pw=0.5)) * bell_env(m, 0.5, 1.0, 1.0, 0.1)
    put(x, bp(chirp, 2600.0, 0.9), 0.11, 0.3)
    k = ns(0.018)
    put(x, square(j(3300.0), k) * fade(np.ones(k), 0.001, 0.006), 0.17, 0.16)
    return master(room(x, rng, 0.008, 0.1), drive=1.8, low_db=1.5, lofi_sr=32000)


@sound("mine_beep", fade=0.03)
def mine_beep(rng, j, v):
    """Armed-mine beep: one sharp G7 pip (higher and shorter than the watch)."""
    n = ns(0.11)
    m = ns(0.07)
    f = NOTE["G7"] * (1.0 + 0.03 * np.exp(-tt(m) / 0.004))         # tiny chirp at the onset
    beep = 0.6 * square(f) + 0.6 * sine(f)
    beep = (bp(beep, 3200.0, 1.5) + 0.3 * beep) * fade(np.ones(m), 0.0015, 0.006)
    x = np.zeros(n)
    put(x, beep, 0.0, 1.0)
    put(x, click(rng, 0.6, 3000.0), 0.0, 0.25)
    x = reverb(x, rng, t60=0.08, mix_=0.08, lo=1000.0, hi=9000.0)
    return master(x, drive=1.3, lofi_sr=26000, bits=10)


@sound("fire_ignite", fade=0.15)
def fire_ignite(rng, j, v):
    """Incendiary 'fwoomp': soft low whump, a flame body that opens then closes, crackle."""
    n = ns(0.55)
    x = 0.3 * thump(n, 125.0, 75.0, 0.04, 0.07, attack=0.015)
    cutoff = points(n, [(0.0, 250.0), (0.07, 2800.0), (0.25, 1200.0), (0.55, 500.0)], "exp")
    env = points(n, [(0.0, 0.15), (0.06, 1.0), (0.2, 0.55), (0.55, 0.0)], "cos")
    flame = bhp(svf(pink(n, rng), cutoff, 0.7, "lp"), 140.0, 2) * env * (0.8 + 0.2 * slow_noise(n, rng, 25.0))
    x += 1.0 * norm(flame)
    x += 0.4 * norm(bhp(white(n, rng), 2500.0, 2)) * bell_env(n, 0.15, 1.5, 2.0)
    x += 0.3 * crackle(n, rng, rate=70.0, tau=0.001, hp_fc=1200.0, env=env)
    x += scatter(n, rng, 5, 0.05, 0.4, lambda r: knock(ns(0.04), r.uniform(200.0, 500.0), 0.008), 0.08, 0.18)
    return master(x, drive=2.0, low_db=2.0, lofi_sr=32000)


@sound("shock_zap", fade=0.09)
def shock_zap(rng, j, v):
    """Shock element: snap, stuttering mains-rate arc, FM 'zzzt' and sparks."""
    n = ns(j(0.38, 0.06))
    env = points(n, [(0.0, 1.0), (0.2, 0.7), (n / SR, 0.0)], "cos")
    x = 0.9 * arc(n, rng, f=j(118.0), bright=3500.0, stutter=40.0) * env
    st = lp1((slow_noise(n, rng, 45.0) > 0.4).astype(float), 800.0)
    x += 0.4 * fm(1800.0 + 900.0 * slow_noise(n, rng, 30.0), 113.0, 4.0) * st * env
    x += 0.12 * blp(saw(j(59.0), n), 400.0, 2) * env
    x += 0.35 * crackle(n, rng, rate=250.0, tau=0.0004, hp_fc=4000.0, env=env)
    x += 0.9 * burst(n, rng, 3000.0, 12000.0, 0.004)
    put(x, click(rng, 1.2, 2500.0), 0.0, 1.0)
    x = reverb(x, rng, t60=0.15, mix_=0.3, lo=500.0, hi=9000.0)
    return master(x, drive=2.2, hp_fc=90.0, lofi_sr=32000, bits=10)


@sound("acid_sizzle", fade=0.18)
def acid_sizzle(rng, j, v):
    """Corrosive element: hissing fizz full of rising bubble blips, dying away."""
    n = ns(0.70)
    env = points(n, [(0.0, 0.7), (0.05, 1.0), (0.5, 0.4), (0.7, 0.0)], "cos")
    x = 0.7 * norm(bbp(white(n, rng), 3500.0, 11000.0) * (0.6 + 0.4 * slow_noise(n, rng, 30.0))) * env
    x += 0.3 * crackle(n, rng, rate=700.0, tau=0.0003, hp_fc=5000.0, env=env)

    def bubble(r, lo=500.0, hi=2500.0, d=(0.012, 0.03)):
        m = ns(r.uniform(*d))
        f0 = lo * (hi / lo) ** r.uniform()
        return sine(log_sweep(m, f0, f0 * 1.6)) * bell_env(m, 0.35, 1.0, 1.5)

    x += scatter(n, rng, 42, 0.0, 0.62, bubble, 0.1, 0.35, early=1.3, fall=0.5)
    x += scatter(n, rng, 4, 0.02, 0.45, lambda r: bubble(r, 200.0, 400.0, (0.035, 0.05)), 0.2, 0.3)
    return master(x, drive=1.5, lofi_sr=32000)
