"""STINGERS -- four one-shots, all built from the Clearance theme.

  start      5.2 s  E minor, 128 BPM.  Timpani + snare roll, tremolo strings
                    swelling, then the theme (trumpet + twangy guitar) lands on
                    an Em(maj9) brass chord with an orchestra hit and a crash.
  complete   9.1 s  E minor -> E major, 108 BPM.  Marching fanfare: the theme
                    (rise), its answer over Am9 - F#7 - B7sus4 - B7, and a Picardy
                    turn onto a big Emaj9 -- the theme's major 7th, now bright.
  death      4.0 s  E minor, 96 BPM.  The mirror form (fall) on a muted
                    trumpet, slowed, a trombone sliding a fifth down under it,
                    then a dry pizzicato plunk and a single vibraphone major 7th
                    ping: wry rather than tragic.
  objective  2.0 s  E minor, 132 BPM.  The theme in diminution on vibes and
                    pizzicato, closed by a soft Em(maj9) horn/brass chord.

Each one is a non-looping Song: written with silence after the last attack so
the natural release and reverb tail are rendered, then trimmed and faded to
digital silence by build.py (mix.trim_sting).
"""
from __future__ import annotations

from emg.seq import Song
from emg.theory import n

from . import motif


def _start() -> Song:
    s = Song("sting_start", bpm=128, bars=3, loop=False, key="E minor")
    s.chords = {1: "B7sus", 2: "Em(maj9)"}
    tpt = s.part("trumpet", 56, level=-8.5, rev=90, vel=104, gate=0.92, human_ms=5, human_vel=3,
                 lay_ms=-10, pan=-0.15, lo="E3", hi="C6", role="lead", space="plate")
    gtr = s.part("guitar", 27, level=-10.0, rev=96, cho=50, vel=100, gate=0.95, human_ms=4,
                 human_vel=3, bend_range=3, pan=0.2, lo="E2", hi="E5", role="lead", hp=80,
                 space="plate")
    brass = s.part("brass", 61, level=-10.0, rev=86, vel=104, gate=0.95, human_ms=4, human_vel=3,
                   lay_ms=-20, pan=0.25, lo="E3", hi="G5", space="plate")
    horns = s.part("horns", 60, level=-14.0, rev=92, vel=96, gate=1.0, human_ms=6, human_vel=3,
                   lay_ms=-40, pan=-0.3, lo="B1", hi="F5", hp=110)
    trem = s.part("tremolo", 44, level=-15.0, rev=92, vel=86, gate=1.0, human_ms=8, human_vel=3,
                  lay_ms=-80, pan=0.18, lo="G3", hi="E6", hp=260)
    bass = s.part("bass", 33, level=-10.0, rev=10, vel=104, gate=0.95, human_ms=3, human_vel=3,
                  lo="E1", hi="E3", role="bass", lp=4000)
    timp = s.part("timpani", 47, level=-10.5, rev=76, vel=104, gate=1.0, human_ms=3, human_vel=3,
                  lo="D2", hi="C3", role="perc")
    hit = s.part("orchhit", 55, level=-11.0, rev=80, vel=110, gate=1.0, human_ms=2, human_vel=2,
                 lo="G2", hi="E5", role="perc", space="plate")
    vibes = s.part("vibes", 11, level=-15.0, rev=92, cho=26, vel=80, gate=1.0, human_ms=5,
                   human_vel=4, pan=0.32, lo="F3", hi="F6", hp=160)
    kit = s.part("kit", 8, drum=True, level=-12.5, rev=40, space="room", human_ms=3, human_vel=4,
                 role="perc")
    cym = s.part("cym", 8, drum=True, level=-16.0, rev=50, space="room", human_ms=3, human_vel=4,
                 role="perc")
    B = s.bar
    land = B(2, 2)                       # the arrival chord (beat 5 overall)
    # roll and swell into the theme
    for i in range(8):
        timp.note(i * 0.25, "B2", 0.25, 58 + i * 6, gate=1.0)
        kit.note(i * 0.25, 38, 0.25, 44 + i * 9)
    trem.chord(0.0, "B3 F#4", 2.0, vel=80)
    trem.ramp(11, 0.0, 1.9, 60, 127, step=0.125)
    trem.chord(2.0, "B4 F#5", 3.0, vel=90)
    horns.chord(0.0, "B2 F#3", 2.0, vel=86)
    horns.ramp(11, 0.0, 1.9, 64, 127, step=0.125)
    horns.chord(2.0, "B2 A3", 3.0, vel=90)
    # the theme
    for part, tonic, v in ((tpt, "E4", 104), (gtr, "E3", 100)):
        ev = motif.play(part, 2.0, tonic, "rise", hold=3.25, vel=v, accent=10)
    gtr.vibrato(land + 0.5, land + 3.0, depth=26, rate=5.8, delay=0.1)
    gtr.glide(land + 3.05, land + 3.6, 0, -200, curve=1.5, after=0)
    tpt.vibrato(land + 0.4, land + 3.0, depth=14, rate=5.4, delay=0.15)
    bass.seq(2.0, "B1:e> B1:e' r:q B1:e D#2:e", vel=100)
    timp.note(2.0, "B2", 1.0, 100)
    timp.note(3.5, "B2", 0.5, 84)
    kit.hits(2.0, "x.......x..xxxxX", "snare", vel_scale=0.9)
    # arrival: Em(maj9)
    brass.chord(land, "D#4 F#4 B4", 3.0, vel=108, top=4)
    horns.chord(land, "E3 G3", 3.2, vel=100)
    trem.chord(land, "B4 B5", 3.2, vel=100)
    bass.note(land, "E1", 3.2, 112)
    bass.note(land, "E2", 3.2, 96)
    timp.note(land, "E2", 1.0, 120)
    hit.chord(land, [n("B2"), n("E3")], 0.8, vel=112)
    vibes.chord(land + 0.02, "F#5 B5 D#6", 3.0, vel=82, strum=0.03)
    cym.note(land, 49, 2.0, 112)
    kit.note(land, 36, 0.5, 118)
    return s


def _complete() -> Song:
    s = Song("sting_complete", bpm=108, bars=4, loop=False, key="E minor -> E major")
    s.chords = {1: "Em(maj9)", 2: "Am9-F#7", 3: "B7sus4-B7 | Emaj9"}
    tpt = s.part("trumpet", 56, level=-8.0, rev=92, vel=104, gate=0.93, human_ms=5, human_vel=3,
                 lay_ms=-10, pan=-0.12, lo="E3", hi="C6", role="lead", space="plate")
    brass = s.part("brass", 61, level=-10.5, rev=86, vel=100, gate=0.9, human_ms=5, human_vel=3,
                   lay_ms=-20, pan=0.28, lo="E3", hi="G5", space="plate")
    horns = s.part("horns", 60, level=-13.0, rev=92, vel=94, gate=1.0, human_ms=6, human_vel=3,
                   lay_ms=-40, pan=-0.3, lo="B1", hi="F5", hp=110)
    trem = s.part("strings", 48, level=-15.0, rev=92, vel=84, gate=1.0, human_ms=8, human_vel=3,
                  lay_ms=-80, pan=0.2, lo="G3", hi="E6", hp=220)
    gtr = s.part("guitar", 27, level=-12.0, rev=94, cho=50, vel=96, gate=0.95, human_ms=4,
                 human_vel=3, bend_range=3, pan=0.3, lo="E2", hi="E5", hp=80, space="plate")
    bass = s.part("bass", 33, level=-10.0, rev=10, vel=100, gate=0.9, human_ms=3, human_vel=3,
                  lo="E1", hi="E3", role="bass", lp=4000)
    timp = s.part("timpani", 47, level=-11.0, rev=76, vel=104, gate=1.0, human_ms=3, human_vel=3,
                  lo="D2", hi="C3", role="perc")
    vibes = s.part("vibes", 11, level=-14.0, rev=92, cho=26, vel=80, gate=1.0, human_ms=5,
                   human_vel=4, pan=0.34, lo="F3", hi="F6", hp=160)
    kit = s.part("kit", 8, drum=True, level=-12.0, rev=38, space="room", human_ms=3, human_vel=5,
                 role="perc")
    cym = s.part("cym", 8, drum=True, level=-16.5, rev=50, space="room", human_ms=3, human_vel=4,
                 role="perc")
    B = s.bar
    # bar 1: the theme over Em(maj9), marching snare
    motif.play(tpt, B(1), "E4", "rise", hold=1.0, vel=102, accent=10)
    brass.chord(B(1, 2.5), "B3 D#4 G4", 0.5, vel=96, gate=0.8)
    brass.chord(B(1, 4), "D#4 F#4 B4", 1.0, vel=100, gate=0.8)
    horns.chord(B(1), "E3 B3", 4.0, vel=88)
    trem.chord(B(1), "G3 B3", 4.0, vel=78)
    bass.seq(B(1), "E2:dq> E2:e' r:e B1:e E2:q", vel=100)
    timp.note(B(1), "E2", 1.0, 106)
    timp.note(B(1, 4), "B2", 1.0, 92)
    # bar 2: the answer, Am9 -> F#7
    ev = motif.play(tpt, B(2), "E4", "answer", hold=0.5, vel=106, accent=10)
    brass.chord(B(2), "A3 C4 E4", 1.5, vel=98, gate=0.85)            # Am9 (the trumpet adds G, F#, B)
    brass.chord(B(2, 3.5), "A#3 C#4 E4", 1.5, vel=102, gate=0.85)    # F#7
    horns.chord(B(2), "A2 E3", 2.5, vel=90)
    horns.chord(B(2, 3.5), "F#2 C#3", 1.5, vel=92)
    trem.chord(B(2), "C4 E4", 2.5, vel=82)
    trem.chord(B(2, 3.5), "A#4 C#5", 1.5, vel=86)
    bass.seq(B(2), "A1:dq> A1:e' r:e F#2:e> F#2:e' C#2:e", vel=100)
    timp.note(B(2), "A2", 1.0, 100)
    timp.note(B(2, 3.5), "F#2", 1.0, 96)
    # bar 3 (two beats): B7sus4 -> B7 under the trumpet, then the Picardy E major
    bass.seq(B(3), "B1:q> B1:e D#2:e", vel=104)
    # (the trumpet's E5 is a 4-3 suspension over B: the brass enter with the 3rd)
    brass.chord(B(3, 2), "A3 D#4 F#4 B4", 1.0, vel=104)
    horns.chord(B(3), "B2 F#3", 2.0, vel=96)
    trem.chord(B(3), "A4 B4 F#5", 2.0, vel=90)
    trem.ramp(11, B(3), B(3, 2.9), 100, 127, step=0.25)
    tpt.seq(B(3, 2.5), "F#5:e", vel=100)
    gtr.seq(B(3), "B2:e D#3:e F#3:e A3:e", vel=94, gate=1.0)
    for i in range(8):
        timp.note(B(3) + i * 0.25, "B2", 0.25, 70 + i * 6, gate=1.0)
    kit.hits(B(3), "-ooxxxxX", "snare")
    fin = B(3, 3)
    # the final chord: Emaj9, ringing out
    tpt.note(fin, "G#5", 3.0, 112)
    tpt.vibrato(fin + 0.4, fin + 2.9, depth=14, rate=5.4, delay=0.1)
    tpt.ramp(11, fin + 1.0, fin + 2.9, 127, 90, step=0.25)
    brass.chord(fin, "E4 G#4 B4 D#5", 3.0, vel=110, top=4)
    brass.ramp(11, fin + 1.0, fin + 2.9, 127, 90, step=0.25)
    horns.chord(fin, "E3 B3 G#4", 3.0, vel=100)
    trem.chord(fin, "B4 D#5 F#5 B5", 3.2, vel=96)
    gtr.note(fin, "E3", 3.0, 104)
    gtr.vibrato(fin + 0.5, fin + 2.9, depth=24, rate=5.6, delay=0.1)
    vibes.chord(fin + 0.02, "G#5 B5 D#6", 3.0, vel=86, strum=0.035)
    vibes.seq(fin + 1.5, "B4:e< G#5:e B5:e D#6:e>", vel=72)
    bass.note(fin, "E1", 3.2, 112)
    bass.note(fin, "E2", 3.2, 96)
    timp.note(fin, "E2", 1.0, 120)
    for i in range(6):
        timp.note(fin + 1.0 + i * 0.25, "B2", 0.25, 82 - i * 5, gate=1.0)
    timp.note(fin + 2.5, "E2", 1.0, 90)
    cym.note(fin, 49, 2.0, 116)
    cym.note(fin + 0.01, 57, 2.0, 100)
    kit.note(fin, 36, 0.5, 120)
    # marching snare under bars 1-2
    for bar in (1, 2):
        kit.hits(B(bar), "x.,,o.,.x.,,o.x.", "snare", vel_scale=0.85)
        kit.hits(B(bar), "x.......x.......", "kick", vel_scale=0.9)
    cym.note(B(1), 57, 2.0, 98)
    return s


def _death() -> Song:
    s = Song("sting_death", bpm=96, bars=2, loop=False, key="E minor")
    s.chords = {1: "Em(maj7)"}
    mute = s.part("mutetpt", 59, level=-9.0, rev=86, vel=96, gate=0.95, human_ms=6, human_vel=3,
                  lay_ms=-8, pan=-0.15, lo="A3", hi="C6", role="lead")
    tbn = s.part("trombone", 57, level=-11.0, rev=80, vel=96, gate=1.0, human_ms=5, human_vel=3,
                 lay_ms=-16, pan=0.18, lo="E2", hi="F4", bend_range=12)
    tuba = s.part("tuba", 58, level=-12.0, rev=50, vel=100, gate=0.9, human_ms=4, human_vel=3,
                  lay_ms=-20, lo="E1", hi="E3", role="bass", lp=3000)
    pizz = s.part("pizz", 45, level=-13.0, rev=50, vel=100, gate=0.5, human_ms=3, human_vel=3,
                  lo="E2", hi="A5")
    vibes = s.part("vibes", 11, level=-17.0, rev=94, cho=26, vel=76, gate=1.0, human_ms=4,
                   human_vel=3, pan=0.3, lo="F3", hi="F6", hp=160)
    timp = s.part("timpani", 47, level=-13.0, rev=72, vel=96, gate=1.0, human_ms=3, human_vel=3,
                  lo="D2", hi="C3", role="perc")
    # the mirror form, slowed: B A# | G F# | E
    ev = motif.play(mute, 0.0, "E4", "fall", hold=1.5, stretch=1.25, vel=96, accent=6)
    mute.vibrato(ev[-1][0] + 0.2, ev[-1][0] + 1.4, depth=18, rate=4.6, delay=0.05)
    # trombone: a long slide from the fifth down under the last notes (the "wah-wah")
    tbn.note(1.875, "B2", 2.0, 98)
    tbn.glide(2.4, 3.8, 0, -700, curve=1.6)
    tbn.bend(3.95, 0)
    tuba.note(0.0, "E2", 1.75, 84)
    tuba.note(1.875, "B1", 1.9, 88)
    timp.note(0.0, "E2", 1.0, 84)
    timp.note(1.875, "B2", 1.0, 76)
    # the plunk: dry low pizz octave, and one bright maj7 ping on top
    pizz.chord(4.0, "E2 E3", 0.5, vel=110)
    tuba.note(4.0, "E1", 0.6, 104, gate=0.6)
    timp.note(4.0, "E2", 1.0, 96)
    vibes.note(4.05, "D#6", 1.5, 78)
    return s


def _objective() -> Song:
    s = Song("sting_objective", bpm=132, bars=1, loop=False, key="E minor")
    s.chords = {1: "Em(maj9)"}
    vibes = s.part("vibes", 11, level=-9.5, rev=90, cho=26, vel=92, gate=1.0, human_ms=3,
                   human_vel=3, pan=0.2, lo="F3", hi="F6", hp=160)
    pizz = s.part("pizz", 45, level=-12.0, rev=70, vel=96, gate=0.6, human_ms=3, human_vel=3,
                  pan=-0.22, lo="E3", hi="B5")
    horns = s.part("horns", 60, level=-13.0, rev=90, vel=88, gate=1.0, human_ms=4, human_vel=3,
                   lay_ms=-30, pan=-0.1, lo="B2", hi="F5", hp=110)
    brass = s.part("brass", 61, level=-14.0, rev=86, vel=90, gate=1.0, human_ms=4, human_vel=3,
                   lay_ms=-20, pan=0.25, lo="E3", hi="G5")
    bass = s.part("bass", 33, level=-14.0, rev=10, vel=92, gate=0.8, human_ms=3, human_vel=3,
                  lo="E1", hi="E3", role="bass", lp=4000)
    bell = s.part("bell", 14, level=-19.0, rev=96, vel=86, gate=1.0, human_ms=2, human_vel=2,
                  pan=0.3, lo="C3", hi="G5", role="perc")
    # the theme in diminution
    motif.play(vibes, 0.0, "E5", "rise", hold=2.0, stretch=0.5, vel=92, accent=8)
    motif.play(pizz, 0.0, "E4", "rise", hold=0.5, stretch=0.5, vel=96, accent=8)
    arrive = 1.5
    horns.chord(arrive, "E3 B3", 1.8, vel=86)
    brass.chord(arrive, "D#4 G4 B4", 1.8, vel=88)
    brass.ramp(11, arrive + 0.5, arrive + 1.7, 127, 80, step=0.125)
    horns.ramp(11, arrive + 0.5, arrive + 1.7, 127, 80, step=0.125)
    bass.note(arrive, "E2", 1.5, 96)
    bell.note(arrive, "B4", 2.0, 88)
    return s


def build() -> dict[str, Song]:
    return {"start": _start(), "complete": _complete(), "death": _death(), "objective": _objective()}
