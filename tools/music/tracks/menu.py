"""MENU -- "Wristwatch in the Dark".

D minor, 92 BPM, 24 bars (62.6 s), straight feel.  Moody lounge-spy: the
menu is a wristwatch glowing in the dark, so a woodblock tick-tock runs under
an upright-bass vamp, brushed kit and vibraphone, and a muted trumpet states
the Clearance theme.

  bars  1- 2  intro   vamp: bass, tick-tock, vibes, brushes
        3-10  A       theme (muted trumpet): statement on i, answer over
                      V/V - V, statement on iv, cadence
       11-18  B       bridge: clean guitar melody over bVI - iv - bVII - III -
                      bII, vibraphone arpeggios, trumpet returns on ii - V
       19-22  A'      theme again, vibes doubling at the octave, guitar comping
       23-24  outro   vamp + tritone-sub turnaround back to bar 1
"""
from __future__ import annotations

from emg.seq import Song

from . import motif

BPM = 92
BARS = 24

CHORDS = {
    1: "Dm6/9", 2: "Dm6/9", 3: "Dm(maj9)", 4: "Dm6/9", 5: "E7b9", 6: "A7sus-A7b9",
    7: "Gm(maj9)", 8: "Gm6", 9: "Em7b5-A7b9", 10: "Dm6/9",
    11: "Bbmaj7#11", 12: "Bbmaj7#11", 13: "Gm9", 14: "C13", 15: "Fmaj9", 16: "Ebmaj7#11",
    17: "Em7b5", 18: "A7b9", 19: "Dm(maj9)", 20: "Dm6/9", 21: "E7b9", 22: "A7sus-A7b9",
    23: "Dm6/9", 24: "Dm6/9-Eb9-A7alt",
}

BASS = {
    1: "D2:dq> A2:e B2:q D3:e r:e",
    2: "D2:dq> F2:e G2:q G#2:e A2:e",
    3: "D2:dq> A2:e B2:q D3:e r:e",
    4: "D2:dq> A2:e B2:q A2:e F2:e",
    5: "E2:dq> B2:e D3:q B2:e G#2:e",
    6: "A1:dq> E2:e G2:q A2:q",
    7: "G2:dq> D2:e E2:q G2:e r:e",
    8: "G2:dq> Bb2:e D3:q Bb2:e G2:e",
    9: "E2:dq> Bb2:e A1:dq> C#2:e",
    10: "D2:dq> A2:e D3:q B2:e A2:e",
    11: "Bb1:dq> F2:e Bb2:q A2:e F2:e",
    12: "Bb1:dq> F2:e D3:q Bb2:e A2:e",
    13: "G1:dq> D2:e G2:q F2:e D2:e",
    14: "C2:dq> G2:e Bb2:q G2:e E2:e",
    15: "F2:dq> C3:e A2:q G2:e F2:e",
    16: "Eb2:dq> Bb2:e G2:q F2:e Eb2:e",
    17: "E2:dq> Bb2:e E2:q G2:e Bb2:e",
    18: "A1:dq> E2:e A2:q G2:e C#2:e",
    19: "D2:dq> A2:e B2:q D3:e r:e",
    20: "D2:dq> A2:e B2:q A2:e F2:e",
    21: "E2:dq> B2:e D3:q B2:e G#2:e",
    22: "A1:dq> E2:e G2:q A2:e C#2:e",
    23: "D2:dq> A2:e B2:q D3:e r:e",
    24: "D2:dq> A2:e Eb2:q A1:e C#2:e",
}

# string pad: (bar, beat, beats, voicing)
PAD = [
    (3, 1, 4, "A3 E4"), (4, 1, 4, "B3 E4"),
    (5, 1, 4, "B3 D4"), (6, 1, 4, "G3 E4"),
    (7, 1, 4, "Bb3 D4"), (8, 1, 4, "Bb3 E4"),
    (9, 1, 2, "Bb3 D4"), (9, 3, 2, "Bb3 C#4"), (10, 1, 3.5, "A3 D4"),
    (11, 1, 4, "F3 A3 D4"), (12, 1, 4, "F3 A3 E4"),
    (13, 1, 4, "F3 Bb3 D4 A4"), (14, 1, 4, "E3 Bb3 D4 A4"),
    (15, 1, 4, "E3 A3 C4 G4"), (16, 1, 4, "D3 G3 Bb3 A4"),
    (17, 1, 4, "D3 G3 Bb3"), (18, 1, 4, "C#3 G3 Bb3"),
    (19, 1, 4, "A3 E4"), (20, 1, 4, "B3 E4"),
    (21, 1, 4, "B3 D4"), (22, 1, 4, "G3 E4"),
    (23, 1, 6, "A3 D4"), (24, 3, 2, "G3 C#4"),
]

# vibraphone arpeggio cells for the bridge (two per bar, eighths)
VIBES_B = {
    11: "D5 A5 E6 A5", 12: "D5 A5 E6 C6", 13: "D5 F5 A5 D6", 14: "E5 A5 D6 A5",
    15: "A4 E5 G5 C6", 16: "G4 D5 F5 A5",
}


def build() -> Song:
    s = Song("menu", bpm=BPM, bars=BARS, key="D minor")
    s.chords = dict(CHORDS)
    for bar, label in ((1, "intro"), (3, "A"), (11, "B"), (19, "A'"), (23, "outro")):
        s.section(bar, label)
    B = s.bar

    bass = s.part("bass", 32, level=-9.0, rev=0, vel=92, gate=0.88, human_ms=7, human_vel=5,
                  lo="E1", hi="G3", role="bass", lp=4500)
    kick = s.part("kick", 40, drum=True, level=-15.0, rev=30, space="room", human_ms=4, human_vel=4,
                  role="perc")
    brush = s.part("brush", 40, drum=True, level=-15.5, rev=50, space="room", human_ms=6,
                   human_vel=6, pan=-0.1, role="perc")
    ride = s.part("ride", 40, drum=True, level=-21.0, rev=45, space="room", human_ms=5,
                  human_vel=6, pan=0.25, role="perc")
    tick = s.part("tick", 0, drum=True, level=-21.5, rev=75, space="hall", human_ms=1.5,
                  human_vel=3, pan=0.2, role="perc")
    perc = s.part("perc", 0, drum=True, level=-20.0, rev=55, space="room", human_ms=7,
                  human_vel=7, pan=-0.3, role="perc")
    vibes = s.part("vibes", 11, level=-11.0, rev=88, cho=28, vel=70, gate=1.0, human_ms=8,
                   human_vel=5, pan=0.28, lo="F3", hi="F6", hp=150)
    pad = s.part("pad", 48, level=-17.0, rev=92, vel=66, gate=1.0, human_ms=10, human_vel=3,
                 lay_ms=-75, pan=-0.2, lo="C3", hi="C6", hp=170, lp=7000)
    tpt = s.part("trumpet", 59, level=-8.5, rev=96, vel=86, gate=0.95, human_ms=9, human_vel=4,
                 lay_ms=6, pan=-0.12, lo="A3", hi="D5", role="lead", lp=7500)
    gtr = s.part("guitar", 27, level=-9.5, rev=90, cho=48, vel=84, gate=0.97, human_ms=8,
                 human_vel=5, lay_ms=4, pan=0.3, lo="E2", hi="A4", role="lead", hp=110)

    # ------------------------------------------------------------- bass
    for bar, line in BASS.items():
        bass.seq(B(bar), line)

    # ------------------------------------------------------------- pad
    for bar, beat, dur, voicing in PAD:
        pad.chord(B(bar, beat), voicing, dur, vel=72 if bar < 11 or bar > 18 else 74)
    # slow swells through the bridge, settle for the reprise
    pad.cc(B(1), 11, 108)
    pad.ramp(11, B(11), B(13), 108, 120, step=0.5)
    pad.ramp(11, B(15), B(18, 4), 118, 127, step=0.5)
    pad.ramp(11, B(19), B(20), 127, 112, step=0.5)
    pad.ramp(11, B(23), B(24, 4.5), 112, 86, step=0.5)
    pad.cc(B(24, 4.9), 11, 127)

    # ------------------------------------------------------------- trumpet (theme)
    def sing(b0, dur, depth=14.0, swell=(100, 124, 96)):
        """Vibrato + a small cresc/dim on a held note."""
        tpt.vibrato(b0, b0 + dur, depth=depth, rate=5.4, delay=0.22, attack=0.35)
        tpt.ramp(11, b0, b0 + dur * 0.5, swell[0], swell[1], step=0.25)
        tpt.ramp(11, b0 + dur * 0.5, b0 + dur * 0.97, swell[1], swell[2], step=0.25)
        tpt.cc(b0 + dur + 0.02, 11, 127)

    for bar, v in ((3, 84), (19, 92)):
        ev = motif.play(tpt, B(bar), "D4", "rise", hold=2.5, vel=v, accent=10)
        sing(ev[-1][0], 2.5)
        ev = motif.play(tpt, B(bar + 2), "D4", "answer", hold=2.75, vel=v + 2, accent=10)
        sing(ev[-1][0], 2.75, depth=17.0)
    # statement on iv and the cadence
    ev = motif.play(tpt, B(7), "G4", "rise", hold=2.5, vel=86, accent=10)
    tpt.seq(B(8, 2.5), "C5:e Bb4:q A4:q", vel=80)
    tpt.seq(B(9), "G4:dq F4:e E4:q C#4:q", vel=82)
    tpt.note(B(10), "D4", 3.0, 80)
    sing(B(10), 3.0, depth=13.0, swell=(104, 116, 70))
    # re-entry over ii - V at the end of the bridge
    tpt.seq(B(17), "Bb4:dq> A4:e G4:q E4:q", vel=84)
    tpt.seq(B(18), "F4:dq E4:e C#4:h", vel=86)
    sing(B(18, 3), 2.0, depth=12.0, swell=(104, 122, 110))
    # last note: the hanging C#5 finally resolves, then a wry little fall
    tpt.note(B(23), "D5", 1.5, 86)
    tpt.glide(B(23, 2.1), B(23, 2.5), 0, -180, curve=1.6, after=0)

    # ------------------------------------------------------------- vibraphone
    def comp(bar, beat, voicing, dur, vel=64, roll=0.0):
        vibes.chord(B(bar, beat), voicing, dur, vel=vel, strum=roll, top=6)

    comp(1, 1, "F3 B3 E4 A4", 2.5, 68, roll=0.022)
    comp(1, 2.5, "B3 E4 A4", 1.5, 54)
    comp(2, 1, "F3 B3 E4 A4", 2.5, 64, roll=0.022)
    vibes.seq(B(2, 3.5), "E5:e A5:q", vel=62)
    comp(3, 1, "F3 A3 E4", 3.0, 64)
    comp(3, 4, "A3 E4", 1.0, 52)
    comp(4, 1, "F3 B3 E4", 2.0, 62)
    vibes.seq(B(4, 3), "E5:e A5:dq", vel=68)
    comp(5, 1, "B3 D4", 3.0, 64)            # no 3rd yet: the melody's 4-3 slip supplies it
    comp(5, 4, "G#3 B3 D4", 1.0, 54)
    comp(6, 1, "G3 Bb3 D4", 1.0, 62)
    comp(6, 2, "G3 Bb3 C#4 E4", 2.75, 66)
    comp(7, 1, "Bb3 D4 E4", 3.0, 64)
    comp(7, 4, "Bb3 D4 E4", 1.0, 52)
    comp(8, 1, "Bb3 D4 E4", 2.0, 60)
    comp(9, 1, "G3 Bb3 D4", 2.0, 62)
    comp(9, 3, "G3 Bb3 C#4", 2.0, 64)
    comp(10, 1, "F3 B3 E4 A4", 2.0, 66, roll=0.02)
    vibes.seq(B(10, 3), "A4:e< D5:e F5:e A5:e>", vel=66)
    # bridge: glassy eighth-note arpeggios, let ring
    for bar, cell in VIBES_B.items():
        notes = cell.split()
        for i in range(8):
            v = 60 + (6 if i % 4 == 0 else 0) + (bar - 11) * 1.2
            vibes.note(B(bar) + i * 0.5, notes[i % 4], 0.5, v, gate=2.4)
    comp(17, 1, "G3 Bb3 D4", 4.0, 62, roll=0.02)
    comp(18, 1, "G3 Bb3 C#4", 3.0, 64, roll=0.02)
    # reprise: double the theme an octave above the trumpet
    motif.play(vibes, B(19), "D5", "rise", hold=2.5, vel=70, accent=8, gate_long=1.3)
    motif.play(vibes, B(21), "D5", "answer", hold=2.75, vel=72, accent=8, gate_long=1.2)
    # outro: slow rolled tonic chord, then the turnaround
    comp(23, 1, "F3 B3 E4 A4 D5", 5.0, 56, roll=0.055)
    comp(24, 3, "G3 Db4 F4 Bb4", 1.0, 60)
    comp(24, 4, "G3 C#4 F4 C5", 1.0, 66)

    # ------------------------------------------------------------- guitar
    gtr.seq(B(11), "F3:e A3:e D4:dq C4:e A3:q")
    gtr.seq(B(12), "E4:h D4:q")
    gtr.vibrato(B(12), B(12, 3), depth=16, rate=5.2, delay=0.25)
    gtr.seq(B(13), "G3:e Bb3:e D4:dq C4:e Bb3:q")
    gtr.seq(B(14), "E4:dq D4:e Bb3:h")
    gtr.vibrato(B(14, 3), B(14, 4.9), depth=15, rate=5.2, delay=0.2)
    gtr.seq(B(15), "A3:q C4:q E4:q G4:q", vel=86)
    gtr.seq(B(16), "G4:h> F4:q D4:q", vel=88)
    # whammy-bar dip on the long G: down a semitone and back
    gtr.glide(B(16, 1.6), B(16, 1.9), 0, -70, curve=0.8)
    gtr.glide(B(16, 1.9), B(16, 2.4), -70, 0, curve=1.2, after=0)
    # reprise: dry comping chops on 2 and 4
    chops = {19: "B3 E4 A4", 20: "B3 E4 A4", 21: "B3 D4 G#4", 22: "G3 C#4 E4"}
    for bar, voicing in chops.items():
        for beat in (2, 4):
            gtr.chord(B(bar, beat), voicing, 0.5, vel=70, gate=0.35, strum=0.008, down=True)

    # ------------------------------------------------------------- drums
    for bar in range(1, BARS + 1):
        b = B(bar)
        intro = bar <= 2
        bridge = 11 <= bar <= 18
        outro = bar >= 23
        # kick: with the bass on 1 and the tresillo push
        kick.hits(b, "x.....-...-....." if bridge else "x.....-.........", "kick",
                  vel_scale=0.8 if (intro or outro) else 0.92)
        # brushes: swirl on every beat, taps on 2 and 4 with ghosts
        brush.hits(b, "o...-...o...-...", "snare2", dur=1.0, vel_scale=0.85)       # swirl
        if not intro:
            tap = "....x..,....x..," if bar % 2 else "....x..,....x.,,"
            brush.hits(b, tap, "snare", vel_scale=0.8 if outro else 0.9)             # tap
        # ride + pedal hat from the second phrase on
        if 7 <= bar <= 22:
            ride.hits(b, "o...-.,.o...-.,.", "ride", vel_scale=0.9 if not bridge else 1.0)
            ride.hits(b, "....-.......-...", "pedal")
        # tick-tock: the watch.  Out during the bridge, back for the outro.
        if not bridge:
            sc = 1.0 if (intro or outro) else 0.8
            tick.hits(b, "x...x...x...x...", "wood_h", vel_scale=sc * 0.78)
            tick.hits(b, "..o...o...o...o.", "wood_l", vel_scale=sc * 0.74)
        # shaker through bridge and reprise, bongos in the reprise
        if 11 <= bar <= 22:
            perc.hits(b, "o.-.o.-.o.-.o.-.", "shaker", vel_scale=0.8)
        if 19 <= bar <= 22:
            perc.hits(b, "..o..o....o..o..", "bongo_h", vel_scale=0.9)
            perc.hits(b, "......o.......o.", "bongo_l", vel_scale=0.9)
    # section markers and fills
    ride.note(B(11), 55, 1.0, 70)                       # soft splash into the bridge
    ride.note(B(19), 55, 1.0, 76)
    brush.hits(B(10, 4), "-ooX", "snare", vel_scale=0.85)
    brush.hits(B(18, 3), "..-.oo-oxxX.", "snare", step=1 / 6, vel_scale=0.9)
    kick.note(B(18, 4.5), 36, 0.25, 84)
    brush.hits(B(24, 3), ",,--ooox", "snare", vel_scale=0.82)
    brush.note(B(24, 4.75), 39, 0.25, 86)               # brush slap as the pick-up
    return s
