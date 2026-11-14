"""Feedback and UI: hit markers, menu blips, the wristwatch, text ticks, objective chimes.

The tonal sounds share one pitch set (E minor / E major-add9, "spy" colour) so
they sit together and against the score: E5 B5 D#6 E6 ... and the watch beeps
on E7.  Chimes use vibraphone-like bars (partials 1 : 4 : 10 with motor tremolo).
"""
from __future__ import annotations

from kit import *  # noqa: F401,F403
from registry import sound

UI_SR = 26000   # a notch more lo-fi than the world sounds: menu samples of the era


def _blip(n: int, f: float, tau: float, body: float = 0.25) -> np.ndarray:
    """Fat little menu tone: triangle + octave sine + a low-passed sub-octave pulse."""
    e = ad_env(n, 0.0008, tau)
    x = tri(f, n) + 0.45 * sine(2.0 * f, n) * np.exp(-tt(n) / (tau * 0.6))
    x = x + body * blp(square(f * 0.5, n, pw=0.4), 1400.0, 2)
    return x * e


@sound("hitmarker", fade=0.02)
def hitmarker(rng, j, v):
    """Tight tick: click, a 1.9 kHz 'tk' and a small knock for body."""
    n = ns(0.07)
    x = modal(n, [1850.0, 2780.0, 4150.0], [0.009, 0.007, 0.005], [1.0, 0.6, 0.3])
    x += 0.5 * knock(n, 620.0, 0.006)
    x += 0.5 * burst(n, rng, 2000.0, 8000.0, 0.003)
    put(x, click(rng, 1.0, 3000.0), 0.0, 0.8)
    return master(x, drive=1.6, lofi_sr=32000)


@sound("hitmarker_crit", fade=0.04)
def hitmarker_crit(rng, j, v):
    """Critical hit: the tick, brighter, answered by a second tone a fifth up (E7 -> B7)."""
    n = ns(0.15)
    x = modal(n, [2100.0, 3150.0, 4700.0], [0.008, 0.006, 0.005], [1.0, 0.6, 0.4])
    x += 0.4 * knock(n, 700.0, 0.006)
    x += 0.6 * burst(n, rng, 2500.0, 10000.0, 0.003)
    put(x, click(rng, 1.0, 3000.0), 0.0, 0.9)
    put(x, bell(n, NOTE["E7"], 0.03, bright=1.2), 0.0, 0.7)
    put(x, bell(n, NOTE["B7"], 0.045, bright=1.2), 0.045, 0.9)
    put(x, modal(ns(0.08), [6300.0, 7450.0, 8900.0], [0.02, 0.016, 0.012], [0.5, 0.4, 0.3], rng=rng), 0.045, 0.25)
    return master(x, drive=1.5, lofi_sr=32000)


@sound("kill_confirm", fade=0.09)
def kill_confirm(rng, j, v):
    """Satisfying low 'thock' with a clean E6 ping on top."""
    n = ns(0.28)
    x = 1.0 * knock(n, 190.0, 0.03, drop=1.5, h=0.3)
    x += 0.6 * burst(n, rng, 200.0, 1500.0, 0.012)
    x += 0.5 * modal(n, [560.0, 1130.0], [0.012, 0.009], [1.0, 0.5])
    put(x, click(rng, 1.2, 1500.0), 0.0, 0.5)
    put(x, bell(n, NOTE["E6"], 0.08), 0.04, 0.6)
    put(x, bell(n, NOTE["E7"], 0.05), 0.04, 0.22)
    x = reverb(x, rng, t60=0.2, mix_=0.2, lo=300.0, hi=6000.0)
    return master(x, drive=1.8, low_db=1.5, lofi_sr=32000)


@sound("enemy_shield_break", fade=0.15)
def enemy_shield_break(rng, j, v):
    """Glassy energy shatter: bright crash, a spray of high pings, falling energy sweep."""
    n = ns(0.55)
    x = multiband(n, rng, [(2500.0, 12000.0, 0.02, 1.0), (600.0, 3000.0, 0.03, 0.6)])
    put(x, click(rng, 1.5, 2500.0), 0.0, 1.0)

    def shard(r):
        f = 2200.0 * (9000.0 / 2200.0) ** r.uniform()
        return ping(ns(0.2), r, f, r.uniform(0.02, 0.09), partials=BAR, detune=0.02)

    x += scatter(n, rng, 22, 0.0, 0.25, shard, 0.15, 0.5, early=1.6, fall=0.4)
    m = ns(0.4)
    f = exp_sweep(m, 2400.0, 260.0, 0.09)
    sweep = svf(saw(f) + 0.5 * square(f * 0.5, pw=0.3), f * 1.5, 2.0, "bp") * ad_env(m, 0.002, 0.12)
    put(x, norm(sweep), 0.0, 0.5)
    put(x, fm(f, f * 2.37, 2.0) * ad_env(m, 0.0, 0.08), 0.0, 0.3)
    x += 0.5 * thump(n, 140.0, 60.0, 0.03, 0.06)
    m2 = ns(0.4)
    put(x, crackle(m2, rng, rate=200.0, tau=0.0004, hp_fc=5000.0, env=exp_env(m2, 0.15)), 0.05, 0.2)
    x = reverb(x, rng, t60=0.4, mix_=0.5, lo=500.0, hi=9000.0)
    return master(x, drive=1.8, lofi_sr=32000)


@sound("ui_move", fade=0.02)
def ui_move(rng, j, v):
    """Menu cursor tick: tiny B5 blip with a click."""
    n = ns(0.06)
    x = _blip(n, NOTE["B5"], 0.012, body=0.2)
    x += 0.4 * knock(n, 330.0, 0.008)
    put(x, click(rng, 0.8, 2000.0), 0.0, 0.35)
    return master(x, drive=1.4, lofi_sr=UI_SR, bits=12)


@sound("ui_select", fade=0.04)
def ui_select(rng, j, v):
    """Confirm: E5 stepping up to B5."""
    n = ns(0.16)
    x = np.zeros(n)
    put(x, _blip(ns(0.05), NOTE["E5"], 0.03), 0.0, 0.9)
    put(x, _blip(n, NOTE["B5"], 0.045), 0.045, 1.0)
    x += 0.4 * knock(n, 220.0, 0.01)
    put(x, click(rng, 0.8, 2000.0), 0.0, 0.35)
    return master(x, drive=1.5, lofi_sr=UI_SR, bits=12)


@sound("ui_back", fade=0.04)
def ui_back(rng, j, v):
    """Cancel: B5 stepping down to E5, darker."""
    n = ns(0.16)
    x = np.zeros(n)
    put(x, _blip(ns(0.05), NOTE["B5"], 0.03), 0.0, 0.9)
    put(x, _blip(n, NOTE["E5"], 0.045), 0.045, 1.0)
    x += 0.4 * knock(n, 180.0, 0.012)
    put(x, click(rng, 0.8, 1500.0), 0.0, 0.25)
    return master(blp(x, 3200.0, 2), drive=1.5, lofi_sr=UI_SR, bits=12)


@sound("ui_equip", fade=0.07)
def ui_equip(rng, j, v):
    """Equip: 'ch-click' of gear locking in, capped with an E5+B5 confirm tone."""
    n = ns(0.28)
    x = np.zeros(n)
    put(x, clack(rng, 0.04, body=500.0, ring=(1700.0, 2900.0), ring_tau=0.006, weight=0.9), 0.0, 0.8)
    m = ns(0.06)
    put(x, scrape(m, rng, 1200.0, 3200.0, q=1.5, rough=0.4, env=bell_env(m, 0.6, 1.0, 1.0, 0.15)), 0.005, 0.3)
    put(x, clack(rng, 0.07, body=320.0, ring=(1500.0, 2500.0, 4000.0), ring_tau=0.010, weight=1.5), 0.07, 0.9)
    put(x, _blip(n, NOTE["E5"], 0.07) + 0.8 * _blip(n, NOTE["B5"], 0.07), 0.075, 0.3)
    return master(x, drive=1.7, low_db=1.0, lofi_sr=UI_SR, bits=12)


@sound("ui_error", fade=0.04)
def ui_error(rng, j, v):
    """Denied: two low, clashing buzzes (D3 against D#3)."""
    n = ns(0.22)
    x = np.zeros(n)
    m = ns(0.075)
    buzz = saw(NOTE["D3"], m) + saw(NOTE["D#3"], m) + 0.6 * sine(NOTE["D2"], m)
    buzz = blp(buzz, 1800.0, 2) * fade(np.ones(m), 0.003, 0.012)
    for t in (0.0, 0.105):
        put(x, buzz, t, 1.0)
        put(x, click(rng, 0.8, 1200.0), t, 0.25)
    return master(x, drive=2.0, low_db=1.0, lofi_sr=UI_SR, bits=10)


@sound("watch_tick", fade=0.012)
def watch_tick(rng, j, v):
    """Mechanical watch escapement.  Variation 1 = 'tick' (higher), 2 = 'tock' (lower)."""
    n = ns(0.045)
    base = (5200.0, 3700.0)[v % 2]
    case = (1250.0, 1050.0)[v % 2]
    x = np.zeros(n)
    for t, g in ((0.0, 1.0), (0.0022, 0.6), (0.0055, 0.8)):          # unlock, impulse, drop
        hit = modal(ns(0.012), [base, base * 1.47, base * 2.1], [0.0025, 0.002, 0.0015], [1.0, 0.6, 0.4], rng=rng)
        put(x, hit, t, g)
        put(x, click(rng, 0.6, 3000.0), t, 0.7 * g)
    x += 0.35 * modal(n, [case, case * 2.3], [0.006, 0.004], [1.0, 0.4])
    return master(x, drive=1.2, lofi_sr=32000)


@sound("watch_beep", fade=0.06)
def watch_beep(rng, j, v):
    """Digital double beep - the detonator.  Piezo-style E7 with a sub-octave for body."""
    n = ns(0.32)
    m = ns(0.095)
    f = NOTE["E7"]
    beep = 0.6 * square(f, m) + 0.5 * sine(f, m) + 0.25 * square(f * 0.5, m)
    beep = (bp(beep, 2900.0, 1.2) + 0.3 * beep) * fade(np.ones(m), 0.002, 0.004)
    x = np.zeros(n)
    put(x, beep, 0.0, 1.0)
    put(x, beep, 0.135, 1.0)
    x = reverb(x, rng, t60=0.10, mix_=0.08, lo=800.0, hi=8000.0)
    return master(x, drive=1.4, lofi_sr=UI_SR, bits=10)


@sound("watch_open", fade=0.09)
def watch_open(rng, j, v):
    """Wrist-watch menu opening: rising air, a tiny servo, latch tick and two glints."""
    n = ns(0.40)
    x = np.zeros(n)
    put(x, whoosh(ns(0.30), rng, 500.0, 3500.0, 2500.0, q=1.4, peak_pos=0.6, floor=0.06), 0.0, 0.7)
    put(x, servo(ns(0.22), rng, 380.0, 760.0, shape=(0.25, 0.7), gear=5.0, res=2200.0), 0.03, 0.42)
    put(x, clack(rng, 0.03, body=900.0, ring=(2700.0, 4300.0), ring_tau=0.005, weight=0.6), 0.27, 0.6)
    put(x, bell(ns(0.12), NOTE["B6"], 0.05), 0.275, 0.25)
    put(x, bell(ns(0.10), NOTE["E7"], 0.04), 0.30, 0.25)
    return master(x, drive=1.5, lofi_sr=32000)


@sound("typewriter", fade=0.015)
def typewriter(rng, j, v):
    """Text tick: key clack with a small type-bar ping."""
    n = ns(j(0.05, 0.1))
    f = j(1150.0) * (1.0, 0.9, 1.1)[v % 3]
    x = 0.8 * knock(n, f, 0.005, h=0.5)
    x += 0.5 * modal(n, [j(3300.0), j(4700.0)], [0.006, 0.004], [1.0, 0.6], rng=rng)
    x += 0.6 * burst(n, rng, 800.0, 5000.0, 0.003)
    x += 0.3 * knock(n, 260.0, 0.006)
    put(x, click(rng, 0.8, 2500.0), 0.0, 0.9)
    return master(x, drive=1.6, lofi_sr=32000)


# --------------------------------------------------------------------------
# objective chimes (vibraphone)
# --------------------------------------------------------------------------
def _vibes(n: int, rng, notes, tau: float = 0.32) -> np.ndarray:
    """notes = [(time_s, note_name, gain), ...] on vibraphone bars."""
    x = np.zeros(n)
    for t, name, g in notes:
        m = n - int(t * SR)
        f = NOTE[name]
        bar = vibe(m, f, tau=tau, trem_hz=5.6, trem=0.2, rng=rng, mallet=0.25)
        bar += 0.35 * vibe(m, f * 1.004, tau=tau * 0.9, trem_hz=5.1, trem=0.2)      # second 'tine' for width
        put(x, bar, t, g)
    return x


def _chime_master(x, rng):
    x = reverb(x, rng, t60=0.55, mix_=0.35, lo=300.0, hi=7000.0)
    return master(x, drive=1.2, lofi_sr=32000)


@sound("objective_new", fade=0.20)
def objective_new(rng, j, v):
    """New objective: E5 - B5 - D#6 rising, left hanging on the major seventh."""
    n = ns(0.78)
    x = _vibes(n, rng, [(0.0, "E5", 0.9), (0.11, "B5", 0.85), (0.22, "D#6", 1.0)])
    put(x, modal(n, [NOTE["E4"]], [0.22], [1.0]), 0.0, 0.3)
    return _chime_master(x, rng)


@sound("objective_done", fade=0.22)
def objective_done(rng, j, v):
    """Objective complete: B4 - E5 - G5 run up into a ringing B5 + E6 (+F#6) chord."""
    n = ns(0.88)
    x = _vibes(n, rng, [(0.0, "B4", 0.8), (0.08, "E5", 0.8), (0.16, "G5", 0.85),
                        (0.25, "B5", 0.9), (0.25, "E6", 1.0), (0.265, "F#6", 0.45)], tau=0.34)
    put(x, modal(n, [NOTE["E3"], NOTE["E4"]], [0.25, 0.22], [0.8, 0.6]), 0.25, 0.3)
    return _chime_master(x, rng)


@sound("checkpoint", fade=0.22)
def checkpoint(rng, j, v):
    """Checkpoint: D#6 grace note snapping to an E5+E6 octave, with one soft echo."""
    n = ns(0.82)
    x = _vibes(n, rng, [(0.0, "D#6", 0.55), (0.07, "E6", 1.0), (0.07, "E5", 0.8), (0.36, "E6", 0.4)], tau=0.30)
    return _chime_master(x, rng)
