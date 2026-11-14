"""Player: footsteps per surface, movement foley, damage, shield and the low-health heartbeat.

Footstep recipe: heel strike (low knock + surface 'tk') followed 40-60 ms later
by a lighter toe roll, plus surface detail (grit / plate ring / sand crunch).
"""
from __future__ import annotations

from kit import *  # noqa: F401,F403
from registry import sound


# --------------------------------------------------------------------------
# footsteps
# --------------------------------------------------------------------------
@sound("footstep_concrete", fade=0.05)
def footstep_concrete(rng, j, v):
    """Boot on concrete: dry heel 'tk', grit, soft toe."""
    n = ns(j(0.18, 0.08))
    x = 0.28 * thump(n, j(170.0), j(105.0), 0.01, 0.014)
    x += 0.5 * knock(n, j(260.0), 0.008)
    x += 1.0 * burst(n, rng, 800.0, 4500.0, j(0.006))
    x += 0.5 * burst(n, rng, 300.0, 1200.0, j(0.010))
    put(x, click(rng, 1.0, 1500.0), 0.0, 0.6)
    m = ns(0.06)
    put(x, crackle(m, rng, rate=900.0, tau=0.0006, hp_fc=2000.0, env=exp_env(m, 0.02)), 0.003, 0.25)
    t_toe = j(0.048, 0.15)
    put(x, burst(ns(0.05), rng, 600.0, 3500.0, 0.008), t_toe, 0.4)
    put(x, knock(ns(0.05), j(160.0), 0.01), t_toe, 0.3)
    x += 0.12 * burst(n, rng, 1500.0, 6000.0, 0.03, attack=0.01)
    return master(room(x, rng, 0.010, 0.12), drive=1.8, low_db=1.5, lofi_sr=32000)


@sound("footstep_metal", fade=0.07)
def footstep_metal(rng, j, v):
    """Boot on steel plate / catwalk: heel thud into a ringing plate with a loose rattle."""
    n = ns(j(0.21, 0.06))
    f = j(330.0) * (1.0, 1.12, 0.9, 1.05)[v % 4]
    x = 0.3 * thump(n, j(165.0), j(100.0), 0.01, 0.015)
    x += 0.8 * burst(n, rng, 900.0, 6000.0, j(0.005))
    put(x, click(rng, 1.0, 1800.0), 0.0, 0.6)
    x += 0.6 * ping(n, rng, f, j(0.05), partials=PLATE, detune=0.03)
    x += 0.3 * ping(n, rng, j(1250.0), j(0.03), partials=BAR, detune=0.03)
    m = ns(0.07)
    put(x, bp(crackle(m, rng, rate=500.0, tau=0.0006, hp_fc=1500.0, env=exp_env(m, 0.025)), 3200.0, 1.5), 0.004, 0.25)
    t_toe = j(0.05, 0.15)
    put(x, burst(ns(0.04), rng, 800.0, 5000.0, 0.005), t_toe, 0.35)
    put(x, ping(ns(0.1), rng, f * 1.31, 0.03, partials=PLATE, detune=0.03), t_toe, 0.25)
    return master(room(x, rng, 0.010, 0.12), drive=1.8, low_db=1.0, lofi_sr=32000)


@sound("footstep_sand", fade=0.07)
def footstep_sand(rng, j, v):
    """Boot in desert sand: soft crunch, no hard edge, a second crunch as the foot rolls."""
    n = ns(j(0.21, 0.06))
    x = 1.0 * burst(n, rng, 300.0, 2500.0, j(0.03), attack=0.004)
    x += 0.5 * crackle(n, rng, rate=1800.0, tau=0.0008, hp_fc=1500.0, env=ad_env(n, 0.005, j(0.035)))
    x += 0.2 * thump(n, j(120.0), j(75.0), 0.02, 0.025, attack=0.004)
    t_toe = j(0.06, 0.15)
    m = ns(0.1)
    put(x, burst(m, rng, 400.0, 3000.0, 0.02, attack=0.006), t_toe, 0.5)
    put(x, crackle(m, rng, rate=1500.0, tau=0.0008, hp_fc=2000.0, env=ad_env(m, 0.006, 0.025)), t_toe, 0.3)
    return master(x, drive=1.5, low_db=1.0, high_db=-2.0, lofi_sr=32000)


# --------------------------------------------------------------------------
# movement
# --------------------------------------------------------------------------
@sound("jump", fade=0.07)
def jump(rng, j, v):
    """Jump (no voice): boot push-off scuff, cloth and a little air."""
    n = ns(0.20)
    x = 0.6 * rustle(n, rng, 400.0, 4500.0, bumps=2, floor=0.15)
    x += 0.4 * whoosh(n, rng, 300.0, 900.0, 500.0, q=1.0, peak_pos=0.4, air=0.1, floor=0.1)
    put(x, burst(ns(0.05), rng, 500.0, 3000.0, 0.012), 0.0, 0.5)
    put(x, knock(ns(0.06), 120.0, 0.015), 0.0, 0.4)
    return master(x, drive=1.4, hp_fc=70.0, lofi_sr=32000)


@sound("land", fade=0.09)
def land(rng, j, v):
    """Landing: two boots a few ms apart, grit, gear settling."""
    n = ns(j(0.28, 0.06))
    x = np.zeros(n)
    for t, g in ((0.0, 1.0), (j(0.018, 0.3), 0.7)):
        put(x, thump(ns(0.2), j(135.0), j(72.0), 0.015, j(0.035), h2=0.2), t, 0.55 * g)
        put(x, burst(ns(0.08), rng, 600.0, 4000.0, 0.02), t, 0.9 * g)
        put(x, burst(ns(0.12), rng, 150.0, 900.0, 0.025), t, 0.6 * g)
        put(x, click(rng, 1.0, 1200.0), t, 0.45 * g)
    for t in (0.05, 0.09):
        put(x, clack(rng, 0.03, body=900.0, ring=(2400.0, 3900.0), ring_tau=0.004, weight=0.4, bright=0.6), j(t, 0.2), 0.15)
    put(x, rustle(ns(0.2), rng, 400.0, 4000.0, bumps=2, floor=0.2), 0.0, 0.3)
    return master(room(x, rng, 0.010, 0.12), drive=2.2, low_db=2.0, lofi_sr=32000)


@sound("slide", fade=0.22)
def slide(rng, j, v):
    """Slide: body and boots scraping over gritty ground, slowing down."""
    n = ns(0.75)
    env = points(n, [(0.0, 0.3), (0.04, 1.0), (0.45, 0.7), (0.75, 0.0)], "cos")
    rough = np.abs(lp(white(n + 512, rng), 200.0))[512:]
    rough = np.minimum(rough / (np.mean(rough) + 1e-9), 3.0)
    x = 1.0 * norm(svf(white(n, rng), log_sweep(n, 2200.0, 900.0), 0.9, "bp") * (0.5 + 0.5 * rough)) * env
    x += 0.5 * norm(bbp(white(n, rng), 80.0, 300.0) * slow_noise(n, rng, 12.0, 0.5, 1.0)) * env
    x += 0.35 * rustle(n, rng, 300.0, 3000.0, bumps=4, floor=0.2) * env
    x += 0.25 * crackle(n, rng, rate=120.0, tau=0.001, hp_fc=1500.0, env=env)
    put(x, knock(ns(0.06), 110.0, 0.02), 0.0, 0.4)
    return master(x, drive=1.6, low_db=1.0, lofi_sr=32000)


@sound("mantle", fade=0.09)
def mantle(rng, j, v):
    """Mantle: two hands slap the ledge, cloth drags, a boot scrapes up."""
    n = ns(0.38)
    x = np.zeros(n)
    for t, g in ((0.0, 1.0), (0.06, 0.8)):
        put(x, burst(ns(0.06), rng, 150.0, 1500.0, 0.012, attack=0.001), t, 0.8 * g)
        put(x, knock(ns(0.08), 140.0, 0.02), t, 0.5 * g)
    put(x, rustle(ns(0.30), rng, 400.0, 4500.0, bumps=3, floor=0.1), 0.05, 0.5)
    m = ns(0.12)
    put(x, scrape(m, rng, 900.0, 1800.0, q=1.0, rough=0.7, rough_hz=90.0, env=bell_env(m, 0.4, 1.0, 1.2, 0.05)), 0.20, 0.35)
    put(x, clack(rng, 0.03, body=900.0, ring=(2300.0, 3700.0), ring_tau=0.004, weight=0.4, bright=0.6), 0.13, 0.12)
    return master(room(x, rng, 0.008, 0.1), drive=1.7, low_db=1.5, lofi_sr=32000)


# --------------------------------------------------------------------------
# damage and shield
# --------------------------------------------------------------------------
@sound("player_hurt", fade=0.07)
def player_hurt(rng, j, v):
    """Player takes a hit (no voice): hard body thud with a crunchy mid crack, gear jolt."""
    n = ns(j(0.22, 0.08))
    x = 0.45 * thump(n, j(155.0), j(82.0), 0.015, j(0.035), h2=0.2)
    x += 1.0 * burst(n, rng, 200.0, 1400.0, j(0.02), attack=0.001)
    x += 0.6 * res_burst(n, rng, j(1050.0), 2.5, 0.008)
    put(x, click(rng, 1.2, 1200.0), 0.0, 0.5)
    put(x, rustle(ns(0.12), rng, 400.0, 3500.0, bumps=1, floor=0.3), 0.005, 0.25)
    return master(x, drive=3.0, low_db=2.0, lofi_sr=32000)


@sound("shield_hit", fade=0.07)
def shield_hit(rng, j, v):
    """Player shield absorbs a hit: falling ping, 80 Hz-gated fizz and a low 'wub' from inside the bubble."""
    n = ns(j(0.22, 0.08))
    t = tt(n)
    f = exp_sweep(n, j(1100.0), j(700.0), 0.04)
    x = 0.7 * (sine(f) + 0.3 * sine(2.0 * f)) * ad_env(n, 0.0005, j(0.05))
    x += 0.3 * fm(f, f * 1.5, 2.5 * np.exp(-t / 0.03)) * ad_env(n, 0.0, 0.04)
    gate = lp1(0.5 + 0.5 * np.sign(square(j(80.0), n)), 3000.0)
    x += 0.8 * norm(bhp(white(n, rng), 2500.0, 2) * gate) * ad_env(n, 0.0, j(0.06))
    x += 0.3 * sine(exp_sweep(n, 170.0, 120.0, 0.05)) * ad_env(n, 0.002, 0.05)
    put(x, click(rng, 1.0, 2500.0), 0.0, 0.4)
    x = reverb(x, rng, t60=0.15, mix_=0.35, lo=300.0, hi=8000.0)
    return master(x, drive=1.8, low_db=1.0, lofi_sr=32000)


@sound("shield_break", fade=0.18)
def shield_break(rng, j, v):
    """Player shield collapses: glassy shatter, then an alarmed tone sliding down into a thump."""
    n = ns(0.75)
    x = multiband(n, rng, [(2500.0, 12000.0, 0.025, 1.0), (500.0, 2500.0, 0.04, 0.7)])
    put(x, click(rng, 1.5, 2000.0), 0.0, 1.0)

    def shard(r):
        f = 2000.0 * 4.0 ** r.uniform()
        return ping(ns(0.2), r, f, r.uniform(0.02, 0.08), partials=BAR, detune=0.02)

    x += scatter(n, rng, 18, 0.0, 0.2, shard, 0.15, 0.45, early=1.6, fall=0.4)
    f = exp_sweep(n, 1250.0, 140.0, 0.22)
    tone = blp(saw(f) + square(f * 1.007, pw=0.4), 3000.0, 2)
    alarm = 1.0 - 0.5 * lp1(0.5 + 0.5 * np.sign(square(14.0, n)), 300.0)
    x += 0.7 * norm(tone * alarm) * points(n, [(0.0, 1.0), (0.5, 0.6), (0.75, 0.0)], "cos")
    x += 0.7 * thump(n, 120.0, 50.0, 0.04, 0.1)
    m = ns(0.5)
    put(x, crackle(m, rng, rate=220.0, tau=0.0004, hp_fc=4000.0, env=exp_env(m, 0.18)), 0.05, 0.2)
    x = reverb(x, rng, t60=0.3, mix_=0.4, lo=300.0, hi=9000.0)
    return master(x, drive=2.0, low_db=1.0, lofi_sr=32000)


@sound("shield_recharge", fade=0.25)
def shield_recharge(rng, j, v):
    """Shield recharging: hum rising two octaves (E2 -> E4) with quickening tremolo, resolving on a soft E6 ding."""
    n = ns(1.50)
    t_ding = 1.12
    m = ns(1.2)
    u = np.arange(m) / m
    f = NOTE["E2"] * 4.0 ** np.clip(u * 1.2 / t_ding, 0.0, 1.0)
    osc = saw(f) + saw(f * 1.006) + 0.5 * square(f * 2.0, pw=0.3)
    hum = svf(osc, 500.0 * 10.0 ** np.clip(u * 1.2 / t_ding, 0.0, 1.0), 1.2, "lp")
    trem = 1.0 - (0.35 - 0.25 * u) * (0.5 + 0.5 * np.sin(TAU * phasor(log_sweep(m, 6.0, 22.0))))
    env = points(m, [(0.0, 0.12), (1.0, 1.0), (t_ding, 0.9), (1.2, 0.0)], "cos")
    x = np.zeros(n)
    put(x, norm(hum * trem) * env, 0.0, 0.8)
    put(x, norm(bhp(white(m, rng), 4000.0, 2)) * env * u, 0.0, 0.10)
    put(x, bell(ns(0.38), NOTE["E6"], 0.16), t_ding, 0.8)
    put(x, bell(ns(0.38), NOTE["B6"], 0.12), t_ding, 0.4)
    put(x, click(rng, 0.8, 2500.0), t_ding, 0.15)
    x = reverb(x, rng, t60=0.5, mix_=0.35, lo=200.0, hi=8000.0)
    return master(x, drive=1.5, low_db=1.0, lofi_sr=32000)


@sound("heartbeat_loop", rotate=False)
def heartbeat_loop(rng, j, v):
    """Low-health heartbeat, exactly 1.000 s (60 bpm): 'lub' at 0.06 s, 'dub' at 0.36 s.

    Each beat is a soft-attack sine sweep with saturation harmonics and a muffled
    low-mid thud so it still reads on small speakers.  The loop starts and ends
    in silence, so the seam is trivially continuous."""
    n = SR
    x = np.zeros(n)
    for t0, f0, f1, tau, g in ((0.06, 110.0, 58.0, 0.075, 1.0), (0.36, 135.0, 70.0, 0.055, 0.8)):
        m = ns(0.42)
        beat = thump(m, f0, f1, 0.035, tau, attack=0.010, h2=0.5)
        beat += 0.9 * burst(m, rng, 70.0, 280.0, tau * 0.7, attack=0.008)
        beat = softclip(norm(beat), 3.0) * fade(np.ones(m), 0.0, 0.12)
        put(x, beat, t0, g)
    return blp(x, 1200.0, 2) * fade(np.ones(n), 0.004, 0.02)
