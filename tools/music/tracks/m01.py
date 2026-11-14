"""MISSION 1 "RECEIVING" -- two synchronised stems.

E minor, 124 BPM, 48 bars (92.9 s).

  base    always playing: the sneaking layer.  Fingered-bass ostinato (tonic
          approached from above and below: b3-2-b2 ... b7-7 -> 1), pizzicato
          off-beats, vibraphone (shell voicings, echoes of the theme), hats,
          shaker, bongos/congas, string pad.
  combat  everything the fight adds: kick/snare/toms, cymbals + tambourine,
          twangy low guitar lead with whammy dips and vibrato, brass stabs,
          trumpet + horns, tremolo strings, timpani, orchestra hits, bell.
          It never plays a bass line, so the two stems sum cleanly.

  bars  1- 8  S1  theme (guitar; vibes echo it two bars later)  Em - F#7 - B7 - C9 - B7#9
        9-16  S2  theme on i and iv, mirror form, brass turnaround
       17-24  S3  bridge, half-time: C lydian - Am9 - F lydian - B7sus; trumpet/horn
                  melody in augmented "slips", vibes arpeggios
       25-32  S4  breakdown and build: tom groove, tremolo strings climbing,
                  tremolo-picked guitar, timpani + snare roll
       33-40  S5  climax: theme in octaves (guitar, trumpet, horns), orchestra hits
       41-48  S6  coda: Em(maj9) - C lydian - F lydian - B7, stop-time turnaround
"""
from __future__ import annotations

from emg.seq import Song
from emg.theory import n

from . import motif

BPM = 124
BARS = 48

CHORDS = {
    1: "Em", 2: "Em", 3: "Em", 4: "Em", 5: "Em-F#7", 6: "B7", 7: "C9", 8: "B7#9",
    9: "Em", 10: "Em", 11: "Am6", 12: "Am6", 13: "Em", 14: "Em", 15: "F#m7b5", 16: "B7b9",
    17: "Cmaj7#11", 18: "Cmaj7#11", 19: "Am9", 20: "Am6", 21: "Fmaj7#11", 22: "Fmaj7#11",
    23: "B7sus(b9)", 24: "B7#9b13",
    25: "Em", 26: "Em", 27: "Em", 28: "Em", 29: "Em", 30: "Em", 31: "B7sus", 32: "B7#9",
    33: "Em", 34: "Em", 35: "Em-F#7", 36: "B7", 37: "Em", 38: "Em", 39: "C9", 40: "B7#9",
    41: "Em(maj9)", 42: "Em6", 43: "Cmaj7#11", 44: "Cmaj7#11", 45: "Fmaj7#11", 46: "Fmaj7#11",
    47: "B7sus(b9)", 48: "B7#9",
}

# ---- bass riff cells on the sixteenth grid: (position, pitch, length[, velocity delta])
_HEAD_E = [(0, "E2", 2, 10), (3, "E2", 1, -14), (6, "G2", 2)]
E_A = _HEAD_E + [(8, "A2", 2), (11, "B2", 2, 4), (14, "D3", 2, -4)]
E_B = _HEAD_E + [(8, "F#2", 2), (10, "F2", 2, 2), (14, "D2", 1, -6), (15, "D#2", 1)]       # -> E
E_Ba = _HEAD_E + [(8, "F#2", 2), (10, "F2", 2, 2), (14, "G2", 1, -6), (15, "G#2", 1)]      # -> A
E_Bb = _HEAD_E + [(8, "F#2", 2), (10, "F2", 2, 2), (14, "A1", 1, -6), (15, "A#1", 1)]      # -> B
E_Bc = _HEAD_E + [(8, "F#2", 2), (10, "F2", 2, 2), (14, "B1", 2)]                          # -> C
E_Bf = _HEAD_E + [(8, "F#2", 2), (10, "F2", 2, 2), (14, "D2", 1, -6), (15, "E2", 1)]       # -> F#
E_FS = _HEAD_E + [(8, "F#2", 3, 6), (11, "A#2", 2), (14, "C#3", 2, -4)]                    # Em -> F#7
_HEAD_B = [(0, "B1", 2, 10), (3, "B1", 1, -14), (6, "D#2", 2), (8, "F#2", 2), (10, "A2", 2)]
B7_A = _HEAD_B + [(12, "B2", 2), (14, "A2", 2, -4)]                                        # -> C
B7_B = _HEAD_B + [(12, "B2", 2), (14, "D2", 1, -6), (15, "D#2", 1)]                        # -> E
B7_C = _HEAD_B + [(12, "C3", 2), (14, "B1", 2)]                                            # b9, -> C
C9 = [(0, "C2", 2, 10), (3, "C2", 1, -14), (6, "E2", 2), (8, "G2", 2), (11, "Bb2", 2, 4), (14, "G2", 2, -4)]
A_A = [(0, "A1", 2, 10), (3, "A1", 1, -14), (6, "C2", 2), (8, "D2", 2), (11, "E2", 2, 4), (14, "G2", 2, -4)]
A_B = [(0, "A1", 2, 10), (3, "A1", 1, -14), (6, "C2", 2), (8, "B1", 2), (10, "Bb1", 2, 2),
       (14, "D2", 1, -6), (15, "D#2", 1)]
FS_O = [(0, "F#2", 2, 10), (3, "F#2", 1, -14), (6, "A2", 2), (8, "C3", 2), (11, "E3", 2, 4), (14, "C3", 2, -4)]
E_HALF = list(_HEAD_E)
E_PICK = [(0, "E2", 2, 10), (14, "D2", 1, -6), (15, "D#2", 1)]
B_PED = [(i * 2, "B1", 2, (8 if i % 2 == 0 else -2) + i) for i in range(8)]
B_RUN = [(0, "B1", 2, 8), (2, "B1", 2), (4, "B1", 2, 4), (6, "B1", 2), (8, "D#2", 2, 6),
         (10, "F#2", 2, 6), (12, "A2", 2, 8), (14, "D2", 1), (15, "D#2", 1, 4)]
C_A = [(0, "C2", 2, 10), (3, "C2", 1, -14), (6, "E2", 2), (8, "G2", 2), (11, "A2", 2, 4), (14, "B2", 2, -4)]
C_B = [(0, "C2", 2, 10), (3, "C2", 1, -14), (6, "E2", 2), (8, "G2", 2), (10, "F#2", 2, 2), (14, "E2", 2)]
F_A = [(0, "F2", 2, 10), (3, "F2", 1, -14), (6, "A2", 2), (8, "C3", 2), (11, "B2", 2, 4), (14, "C3", 2, -4)]
F_B = [(0, "F2", 2, 10), (3, "F2", 1, -14), (6, "A2", 2), (8, "C3", 2), (10, "B2", 2), (12, "A2", 2), (14, "C3", 2)]
B_TRES = [(0, "B1", 3, 10), (3, "B1", 3), (6, "B1", 2, 4), (8, "B1", 3, 6), (11, "B1", 3), (14, "B1", 2, 4)]
B_END = [(0, "B1", 3, 10), (3, "B1", 3), (6, "B1", 2, 4), (8, "D#2", 2), (10, "F#2", 2), (12, "A2", 2, 4),
         (14, "D2", 1), (15, "D#2", 1, 4)]

BASS_CELLS = {
    1: E_A, 2: E_B, 3: E_A, 4: E_B, 5: E_FS, 6: B7_A, 7: C9, 8: B7_B,
    9: E_A, 10: E_Ba, 11: A_A, 12: A_B, 13: E_A, 14: E_Bf, 15: FS_O, 16: B7_C,
    25: E_HALF, 26: E_PICK, 27: E_HALF, 28: E_PICK, 29: E_A, 30: E_Bb, 31: B_PED, 32: B_RUN,
    33: E_A, 34: E_B, 35: E_FS, 36: B7_B, 37: E_A, 38: E_Bc, 39: C9, 40: B7_B,
    41: E_A, 42: E_Bc, 43: C_A, 44: C_B, 45: F_A, 46: F_B, 47: B_TRES, 48: B_END,
}
BASS_BRIDGE = {
    17: "C2:dq> C2:e r:e G2:e C3:q",
    18: "C2:dq> C2:e E2:e G2:e B2:e G2:e",
    19: "A1:dq> A1:e r:e E2:e A2:q",
    20: "A1:dq> A1:e C2:e E2:e F#2:e E2:e",
    21: "F2:dq> F2:e r:e C2:e F2:q",
    22: "F2:dq> F2:e A2:e C3:e E3:e C3:e",
    23: "B1:dq> B1:e r:e F#2:e B2:q",
    24: "B1:dq> B1:e D#2:e F#2:e A2:e B2:e",
}

# ---- pizzicato: off-beat eighths (four per bar) or full eighths (eight per bar)
_PZ_A, _PZ_B = "B4 E5 C#5 B4", "B4 F#5 E5 B4"
PIZZ = {
    1: _PZ_A, 2: _PZ_B, 3: _PZ_A, 4: _PZ_B, 5: "B4 E5 C#5 A#4", 6: "A4 D#5 B4 A4",
    7: "Bb4 E5 D5 Bb4", 8: "A4 F#5 D5 A4",
    9: _PZ_A, 10: _PZ_B, 11: "C5 E5 F#5 E5", 12: "C5 F#5 E5 C5", 13: _PZ_A, 14: _PZ_B,
    15: "C5 E5 A4 C5", 16: "C5 D#5 A4 D#5",
    25: "B4 E5 B4 E5", 26: "B4 E5 B4 E5", 27: "B4 E5 B4 E5", 28: "B4 E5 B4 E5",
    29: "B4 E5 B4 E5", 30: "B4 E5 B4 E5", 31: "A4 E5 A4 E5", 32: "A4 D#5 A4 D#5",
    33: "E5 B4 G4 B4 G4 B4 E5 B4", 34: "E5 B4 G4 B4 E5 B4 G4 B4",
    35: "E5 B4 G4 B4 E5 A#4 C#5 A#4", 36: "F#5 A4 D#5 A4 F#5 A4 D#5 A4",
    37: "E5 B4 G4 B4 G4 B4 E5 B4", 38: "E5 B4 G4 B4 E5 B4 G4 B4",
    39: "E5 Bb4 G4 Bb4 D5 Bb4 E5 Bb4", 40: "F#5 A4 F#4 A4 D5 A4 F#5 A4",
    41: "B4 D#5 F#5 B4", 42: "B4 C#5 E5 B4", 43: "B4 E5 F#5 E5", 44: "B4 G5 F#5 E5",
    45: "A4 E5 B4 C5", 46: "A4 E5 C5 B4", 47: "A4 F#5 E5 A4", 48: "A4 F#5 D5 A4",
}

# ---- string pad (base): (bar, beat, beats, voicing)
PAD = [
    (9, 1, 8, "B3 F#4"), (11, 1, 8, "E4 F#4"), (13, 1, 8, "E4 D5"),
    (15, 1, 4, "A3 C4 E4"), (16, 1, 4, "A3 C4 D#4"),
    (17, 1, 8, "B3 E4"), (19, 1, 4, "G3 E4"), (20, 1, 4, "F#3 C4 E4"),
    (21, 1, 8, "A3 E4"), (23, 1, 4, "A3 C4 E4"), (24, 1, 4, "A3 G4"), (24, 2, 3, "D#4"),
    (25, 1, 24, "E4 B4"), (31, 1, 4, "A3 E4"), (32, 1, 4, "A3 D#4"),
    (33, 1, 8, "B3 F#4"), (35, 1, 2, "B3 E4"), (35, 3, 2, "A#3 C#4 E4"), (36, 1, 1, "A3 F#4"),
    (36, 2, 3, "A3 D#4 F#4"),
    (37, 1, 8, "E4 D5"), (39, 1, 4, "G3 Bb3 E4"), (40, 1, 4, "A3 D#4 F#4"),
    (41, 1, 4, "B3 F#4"), (42, 1, 4, "B3 C#4 E4"), (43, 1, 4, "B3 E4"), (44, 1, 4, "B3 F#4"),
    (45, 1, 4, "A3 E4"), (46, 1, 4, "A3 B3 E4"), (47, 1, 4, "A3 E4"), (48, 1, 4, "A3 D#4"),
]

# ---- vibraphone arpeggio cells for the bridge (eighths, two cells per bar)
VIBES_BRIDGE = {
    17: "E5 F#5 B5 F#5", 18: "E5 G5 B5 G5", 19: "E5 G5 B5 G5", 20: "E5 F#5 A5 F#5",
    21: "E5 A5 B5 A5", 22: "E5 B5 C6 B5", 23: "E5 A5 C6 A5", 24: "E5 G5 A5 D6 D#5 G5 A5 D6",
}

# ---- brass voicings
EM9, EM69, EM, EM6 = "D#4 F#4 G4 B4", "C#4 F#4 G4 B4", "B3 E4 G4 B4", "E4 G4 B4 C#5"
B7, B7S9, B7B9, B7SUS, B7FULL = "D#4 F#4 A4 B4", "D#4 A4 D5", "A3 C4 D#4 F#4", "A3 E4 F#4 A4", "A3 D#4 F#4 A4"
C9V, AM6, FSO = "E4 G4 Bb4 D5", "E4 F#4 A4", "A3 C4 E4 F#4"


def build() -> Song:
    s = Song("m01", bpm=BPM, bars=BARS, key="E minor")
    s.chords = dict(CHORDS)
    for bar, label in ((1, "S1 theme"), (9, "S2 theme/iv"), (17, "S3 bridge"), (25, "S4 build"),
                       (33, "S5 climax"), (41, "S6 coda")):
        s.section(bar, label)
    B = s.bar

    # ================================================================ BASE
    bass = s.part("bass", 33, stem="base", level=-9.5, rev=0, vel=98, gate=0.86, human_ms=5,
                  human_vel=4, lo="E1", hi="E3", role="bass", lp=5000)
    hats = s.part("hats", 0, drum=True, stem="base", level=-20.5, rev=28, space="room",
                  human_ms=4, human_vel=6, pan=0.22, role="perc")
    shaker = s.part("shaker", 0, drum=True, stem="base", level=-22.5, rev=30, space="room",
                    human_ms=6, human_vel=6, pan=-0.3, role="perc")
    bongos = s.part("bongos", 0, drum=True, stem="base", level=-17.5, rev=50, space="room",
                    human_ms=7, human_vel=7, pan=0.35, role="perc")
    vibes = s.part("vibes", 11, stem="base", level=-12.0, rev=86, cho=26, vel=76, gate=1.0,
                   human_ms=7, human_vel=5, pan=-0.26, lo="F3", hi="F6", hp=160)
    pizz = s.part("pizz", 45, stem="base", level=-14.5, rev=72, vel=84, gate=0.5, human_ms=6,
                  human_vel=6, lay_ms=-38, pan=0.2, lo="G3", hi="A5", hp=200)
    pad = s.part("pad", 48, stem="base", level=-17.5, rev=92, vel=70, gate=1.0, human_ms=10,
                 human_vel=3, lay_ms=-80, pan=0.05, lo="C3", hi="C6", hp=180, lp=6500)

    # ---- bass
    for bar, cells in BASS_CELLS.items():
        soft = 25 <= bar <= 28
        bass.cells(B(bar), cells, vel=88 if soft else 98)
    for bar, line in BASS_BRIDGE.items():
        bass.seq(B(bar), line, vel=94, gate=0.94)

    # ---- pizzicato
    for bar, cell in PIZZ.items():
        notes = cell.split()
        if len(notes) == 8:
            for i, p in enumerate(notes):
                pizz.note(B(bar) + i * 0.5, p, 0.5, 88 if i % 2 == 0 else 78)
        else:
            quiet = 25 <= bar <= 30
            for i, p in enumerate(notes):
                v = (70 if quiet else 84) + (4 if i == 1 else 0) + (bar - 25) * 2 * quiet
                pizz.note(B(bar) + 0.5 + i, p, 0.5, v)

    # ---- pad
    for bar, beat, dur, voicing in PAD:
        pad.chord(B(bar, beat), voicing, dur, vel=66 if 25 <= bar <= 30 else 72)
    pad.cc(B(1), 11, 110)
    pad.ramp(11, B(23), B(24, 4.5), 110, 127, step=0.5)
    pad.ramp(11, B(25), B(25, 2), 127, 92, step=0.25)
    pad.ramp(11, B(29), B(32, 4.5), 92, 127, step=0.5)
    pad.ramp(11, B(41), B(43), 127, 110, step=0.5)
    pad.cc(B(48, 4.9), 11, 127)

    # ---- vibraphone
    def shell(bar, beat, voicing, dur, vel=70, roll=0.0):
        vibes.chord(B(bar, beat), voicing, dur, vel=vel, strum=roll, top=5)

    # S1: echo the theme two bars after the guitar, then tritone shells
    motif.play(vibes, B(3), "E5", "rise", hold=4.0, vel=74, accent=8, gate_long=1.2)
    shell(5, 3, "A#4 E5", 2.0, 68)
    shell(6, 1, "A4 D#5", 3.5, 70)
    shell(7, 1, "Bb4 E5", 3.5, 70)
    shell(8, 1, "D#4 A4 D5", 1.5, 72)
    shell(8, 2.5, "D#4 A4 D5", 2.0, 76)
    # S2: shadow the lead two octaves up on iv and on the mirror phrase
    motif.play(vibes, B(11), "A5", "rise", hold=2.5, vel=68, accent=8, gate_long=1.2)
    motif.play(vibes, B(13), "E5", "fall", hold=3.0, vel=70, accent=8, gate_long=1.2)
    shell(15, 1, "A4 C5 E5", 3.5, 68)
    shell(16, 1, "A4 C5 D#5", 1.5, 70)
    shell(16, 2.5, "A4 C5 D#5", 2.0, 74)
    # S3: arpeggios over the bridge, low E pedal slipping to D# in the last bar
    for bar, cell in VIBES_BRIDGE.items():
        notes = cell.split()
        for i in range(8):
            v = 62 + (7 if i % 4 == 0 else 0) + (bar - 17) * 1.5
            vibes.note(B(bar) + i * 0.5, notes[i % len(notes)], 0.5, v, gate=2.2)
    # S4: single slips climbing the triad, one every two bars
    for bar, hi_note, lo_note, long_ in ((25, "E5", "D#5", 3.0), (27, "G5", "F#5", 3.0),
                                         (29, "B5", "A#5", 1.5)):
        vibes.note(B(bar), hi_note, 0.5, 78 + (bar - 25) * 2)
        vibes.note(B(bar, 1.5), lo_note, long_, 70 + (bar - 25) * 2, gate=1.1)
    vibes.note(B(31), "E6", 4.0, 84)                    # ... the last one held over B7sus
    vibes.note(B(32), "D#6", 3.5, 86, gate=1.1)         # and released when the 3rd arrives
    # S5: the theme (base's own climax; doubles guitar + trumpet when the fight is on)
    motif.play(vibes, B(33), "E5", "rise", hold=4.0, vel=84, accent=8, gate_long=1.15)
    motif.play(vibes, B(35), "E5", "answer", hold=2.75, vel=84, accent=8, gate_long=1.15)
    motif.play(vibes, B(37), "E5", "fall", hold=3.0, vel=82, accent=8, gate_long=1.15)
    shell(39, 1, "Bb4 E5 D6", 3.5, 76)
    shell(40, 1, "D#4 A4 D5", 1.5, 76)
    shell(40, 2.5, "D#4 A4 D5", 2.0, 80)
    # S6: rolled colour chords
    shell(41, 1, "B4 D#5 F#5", 4.0, 74, roll=0.03)
    shell(42, 1, "G4 B4 C#5 E5", 4.0, 68, roll=0.03)
    shell(43, 1, "B4 E5 F#5", 7.5, 70, roll=0.03)
    shell(45, 1, "A4 E5 B5", 7.5, 70, roll=0.03)
    shell(47, 1, "A4 E5 F#5", 4.0, 70, roll=0.02)
    shell(48, 1, "D#4 A4 D5", 1.5, 72)
    shell(48, 2.5, "D#4 A4 D5", 2.0, 78)

    # ---- hand percussion and hats
    for bar in range(1, BARS + 1):
        b = B(bar)
        sec = (bar - 1) // 8 + 1
        if sec in (1, 2, 6):
            hats.hits(b, "x.o.x.o.x.o.x.o.", "hat", vel_scale=0.92)
            if bar % 4 == 0:
                hats.hits(b + 3.5, "x", "ohat", vel_scale=0.8)
        elif sec == 3:
            hats.hits(b, "x...o...x...o...", "pedal", vel_scale=0.9)
        elif sec == 4:
            sc = 0.55 + 0.06 * (bar - 25)
            hats.hits(b, "x,-,o,-,x,-,o,-,", "hat", vel_scale=sc)
            hats.hits(b, "x..o..o.........", "stick", vel_scale=0.75 + 0.03 * (bar - 25))
        else:  # climax: sixteenths
            hats.hits(b, "x-o-x-o-x-o-x-o-", "hat", vel_scale=0.95)
            if bar % 2 == 0:
                hats.hits(b + 3.5, "x", "ohat", vel_scale=0.85)
        if (bar >= 5 and sec in (1, 2)) or sec in (5, 6):
            shaker.hits(b, "-,o,-,o,-,o,-,o,", "shaker", vel_scale=1.0)
        elif sec == 3:
            shaker.hits(b, "o.-.o.-.o.-.o.-.", "shaker", vel_scale=0.9)
        if (bar >= 5 and sec in (1, 2)) or sec in (5, 6):
            bongos.hits(b, "..x..x....x..x..", "bongo_h")
            bongos.hits(b, "......o.......oo" if bar % 2 else "......o.....o.o.", "bongo_l")
        elif sec == 3:
            bongos.hits(b, "x..o..x...o.x...", "conga_h", vel_scale=0.9)
            bongos.hits(b, "......o.......o.", "conga_l", vel_scale=0.95)
    bongos.hits(B(16, 3), "x.xxo.oo", "bongo_h")
    bongos.hits(B(24, 4), "x.xx", "conga_l")

    # ============================================================== COMBAT
    kit = s.part("kit", 8, drum=True, stem="combat", level=-7.0, rev=34, space="room",
                 human_ms=3.5, human_vel=5, role="perc", clip_db=2.5)
    cym = s.part("cym", 8, drum=True, stem="combat", level=-16.0, rev=42, space="room",
                 human_ms=5, human_vel=6, pan=-0.15, role="perc")
    gtr = s.part("guitar", 27, stem="combat", level=-7.0, rev=94, cho=55, vel=98, gate=0.96,
                 human_ms=6, human_vel=4, bend_range=3, pan=0.12, lo="E2", hi="E5", role="lead",
                 hp=75)
    brass = s.part("brass", 61, stem="combat", level=-9.0, rev=82, vel=100, gate=0.9,
                   human_ms=5, human_vel=4, lay_ms=-24, pan=0.28, lo="E3", hi="G5")
    tpt = s.part("trumpet", 56, stem="combat", level=-9.5, rev=88, vel=98, gate=0.95,
                 human_ms=7, human_vel=4, lay_ms=-10, pan=-0.2, lo="E3", hi="C6", role="lead")
    horns = s.part("horns", 60, stem="combat", level=-13.5, rev=92, vel=92, gate=0.98,
                   human_ms=8, human_vel=4, lay_ms=-48, pan=-0.3, lo="B1", hi="F5", hp=120)
    trem = s.part("tremolo", 44, stem="combat", level=-14.5, rev=92, vel=84, gate=1.0,
                  human_ms=10, human_vel=3, lay_ms=-80, pan=0.22, lo="G3", hi="E6", hp=260)
    timp = s.part("timpani", 47, stem="combat", level=-11.5, rev=74, vel=104, gate=1.0,
                  human_ms=4, human_vel=4, pan=-0.1, lo="D2", hi="C3", role="perc")
    hit = s.part("orchhit", 55, stem="combat", level=-9.5, rev=78, vel=108, gate=1.0,
                 human_ms=3, human_vel=3, lay_ms=-14, lo="G2", hi="E5", role="perc")
    bell = s.part("bell", 14, stem="combat", level=-15.0, rev=96, vel=96, gate=1.0,
                  human_ms=3, human_vel=3, pan=0.3, lo="C3", hi="G5", role="perc")

    # ---- drum kit
    G1A = {"kick": "x.....x...x.....", "snare": "....x..,.,..x..,"}
    G1B = {"kick": "x.....x.x..x....", "snare": "....x..,....x.,,"}
    HALF_A = {"kick": "x..x......x.....", "snare": "........x......,"}
    HALF_B = {"kick": "x..x.....xx.....", "snare": "........x....,,,"}
    fills = {
        8: {"kick": "x.....x...x.....", "snare": "....x.......x.xx"},
        16: {"kick": "x.....x...x.....", "snare": "....x...x.x.....", "tom_h": "............xx..",
             "tom_l": "..............x.", "tom_f2": "...............x"},
        24: {"kick": "x..x......x.....", "snare": "........o.o.xxxX"},
        40: {"kick": "x.....x...x..x..", "snare": "....x.....xx....", "tom_hm": "............x...",
             "tom_l": ".............x..", "tom_f2": "..............xx"},
    }
    for bar in range(1, BARS + 1):
        b = B(bar)
        sec = (bar - 1) // 8 + 1
        if bar in fills:
            kit.drums(b, fills[bar])
        elif sec in (1, 2, 5) or bar in (41, 42, 43, 44, 45, 46):
            kit.drums(b, G1A if bar % 2 else G1B, vel_scale=1.0 if sec != 6 else 0.94)
        elif sec == 3:
            kit.drums(b, HALF_A if bar % 2 else HALF_B)
        elif sec == 4 and bar <= 31:
            sc = 0.62 + 0.055 * (bar - 25)
            kit.hits(b, "x..x..x.x..x..x.", "tom_f2", vel_scale=sc)
            kit.hits(b, "x.......x.......", "kick", vel_scale=sc + 0.05)
            if bar >= 29:
                kit.hits(b, "....o.......o...", "tom_l", vel_scale=sc)
    # bar 32: full-bar snare roll into the climax
    kit.hits(B(32), ",,gg--ooooxxxxXX", "snare")
    kit.hits(B(32), "x...x...x...x.x.", "kick", vel_scale=0.95)
    # bars 47-48: stop-time on the tresillo, then the fill home
    kit.hits(B(47), "X.....X.....X...", "kick")
    kit.hits(B(47), "X.....X.....X...", "snare")
    kit.hits(B(48), "X.....X.x...x...", "kick")
    kit.hits(B(48), "X.....X.xxxx....", "snare")
    kit.hits(B(48), "............xx..", "tom_h")
    kit.hits(B(48), "..............x.", "tom_l")
    kit.hits(B(48), "...............X", "tom_f2")

    # ---- cymbals, tambourine, metal
    for bar in range(1, BARS + 1):
        b = B(bar)
        sec = (bar - 1) // 8 + 1
        if sec in (1, 2, 5, 6) and bar < 47:
            cym.hits(b, "..o...x...o...x.", "tamb", vel_scale=0.9)
        if sec == 3:
            cym.hits(b, "x...o...x...o...", "bell", vel_scale=0.85)
            cym.hits(b, "x..x..o.....o...", "agogo_h", vel_scale=0.8)
            cym.hits(b, ".....x....x.....", "agogo_l", vel_scale=0.8)
        if sec == 5:
            cym.hits(b, "x.o.x.o.x.o.x.o.", "ride", vel_scale=0.8)
            cym.hits(b, "....x.......x...", "agogo_l", vel_scale=0.95)
    for bar, v in ((1, 104), (9, 100), (17, 96), (25, 92), (33, 112), (37, 100), (41, 106)):
        cym.note(B(bar), 49, 2.0, v)
    cym.note(B(5), 57, 2.0, 88)
    cym.note(B(13), 57, 2.0, 88)
    cym.note(B(39), 52, 2.0, 100)                      # china on the C9 hit
    for pos in (0, 6, 12):
        cym.note(B(47) + pos * 0.25, 57, 1.0, 104)
    for pos in (0, 6):
        cym.note(B(48) + pos * 0.25, 49, 1.0, 106)

    # ---- guitar lead
    def dip(beat, depth=-90.0, down=0.12, up=0.35):
        gtr.glide(beat, beat + down, 0, depth, curve=0.8)
        gtr.glide(beat + down, beat + down + up, depth, 0, curve=1.3, after=0)

    def scoop(beat, frm=-100.0, dur=0.16):
        gtr.bend(beat - 0.03, frm)
        gtr.glide(beat, beat + dur, frm, 0, curve=0.7, after=0)

    def vib(b0, b1, depth=20.0):
        gtr.vibrato(b0, b1, depth=depth, rate=5.6, delay=0.16, attack=0.3)

    # S1
    ev = motif.play(gtr, B(1), "E3", "rise", hold=4.0, vel=100, accent=10)
    dip(ev[-1][0] + 0.02, depth=-60, down=0.1, up=0.25)
    vib(ev[-1][0] + 1.0, ev[-1][0] + 3.9)
    gtr.seq(B(4, 4), "B2:e E3:e", vel=86)
    ev = motif.play(gtr, B(5), "E3", "answer", hold=2.75, vel=102, accent=10)
    scoop(ev[4][0])
    vib(ev[5][0], ev[5][0] + 2.7, depth=24)
    gtr.seq(B(7), "E4:e> D4:q Bb3:e> G3:q E3:q", vel=98)
    gtr.seq(B(8), "D#3:dq F#3:e A3:q B3:q", vel=98)
    # S2
    ev = motif.play(gtr, B(9), "E3", "rise", hold=2.0, vel=100, accent=10)
    gtr.seq(B(10, 2.5), "D4:e E4:1.9", vel=100)
    scoop(B(10, 3), frm=-100, dur=0.2)
    vib(B(10, 3.4), B(10, 4.95), depth=22)
    ev = motif.play(gtr, B(11), "A3", "rise", hold=3.0, vel=102, accent=10)
    dip(ev[-1][0] + 1.2, depth=-80)
    gtr.seq(B(12, 4), "D4:e C4:e", vel=88)
    ev = motif.play(gtr, B(13), "E3", "fall", hold=3.5, vel=102, accent=10)
    vib(ev[-1][0], ev[-1][0] + 2.0, depth=18)
    gtr.glide(ev[-1][0] + 2.2, ev[-1][0] + 3.3, 0, -230, curve=1.5, after=0)   # slow dive
    # S3: twangy answers in the gaps of the trumpet melody
    gtr.seq(B(18, 3), "E3:e G3:e B3:q", vel=92)
    dip(B(18, 4.1), depth=-70)
    gtr.seq(B(20, 3), "C3:e E3:e F#3:q", vel=92)
    dip(B(20, 4.1), depth=-70)
    gtr.seq(B(22, 3), "A3:e C4:e E4:q", vel=94)
    dip(B(22, 4.1), depth=-70)
    gtr.seq(B(24, 3), "B2:s D#3:s F#3:s A3:s B3:s D#4:s F#4:s A4:s", vel=92, gate=1.0)
    # S4: dive bomb, then a tremolo-picked climb
    gtr.note(B(25), "E2", 6.0, 108)
    gtr.glide(B(25, 2.5), B(26, 4), 0, -280, curve=1.4)
    gtr.bend(B(27, 1.5), 0)
    climb = [(29, ["B2"] * 16), (30, ["D3"] * 16), (31, ["E3"] * 8 + ["F#3"] * 8),
             (32, ["A3"] * 8 + ["B3"] * 4 + ["D#4"] * 4)]
    for bar, notes in climb:
        for i, p in enumerate(notes):
            v = 62 + (bar - 29) * 10 + i * 0.5 + (8 if i % 4 == 0 else 0)
            gtr.note(B(bar) + i * 0.25, p, 0.25, v, gate=0.9)
    # S5: the theme an octave higher
    ev = motif.play(gtr, B(33), "E4", "rise", hold=4.0, vel=106, accent=10)
    vib(ev[-1][0] + 0.8, ev[-1][0] + 3.9, depth=22)
    ev = motif.play(gtr, B(35), "E4", "answer", hold=2.75, vel=108, accent=10)
    scoop(ev[4][0])
    vib(ev[5][0], ev[5][0] + 2.7, depth=24)
    ev = motif.play(gtr, B(37), "E4", "fall", hold=3.0, vel=106, accent=10)
    vib(ev[-1][0] + 0.5, ev[-1][0] + 2.9, depth=20)
    gtr.seq(B(39), "E5:e> D5:q Bb4:e> G4:q E4:q", vel=104)
    gtr.seq(B(40), "D#4:dq F#4:e A4:q B4:q", vel=104)
    # S6
    ev = motif.play(gtr, B(41), "E3", "rise", hold=4.0, vel=98, accent=10)
    vib(ev[-1][0] + 1.0, ev[-1][0] + 3.9)
    gtr.seq(B(43), "G3:q F#3:dh", vel=94)
    vib(B(43, 2), B(43, 4.9), depth=16)
    gtr.seq(B(44), "E3:h B2:h", vel=90)
    gtr.seq(B(45), "C4:q B3:dh", vel=96)
    vib(B(45, 2), B(45, 4.9), depth=16)
    gtr.seq(B(46), "A3:h E3:h", vel=92)
    for pos in (0, 6, 12):
        gtr.note(B(47) + pos * 0.25, "B2", 0.5, 106, gate=0.7)
    for pos in (0, 6):
        gtr.note(B(48) + pos * 0.25, "B2", 0.5, 106, gate=0.7)
    gtr.note(B(48, 3), "B2", 1.9, 104)
    gtr.glide(B(48, 3.3), B(48, 4.8), 0, -260, curve=1.3, after=0)

    # ---- brass stabs
    def stab(bar, positions, voicing, vel=98, dur=1.5):
        for pos in positions:
            brass.chord(B(bar) + pos * 0.25, voicing, dur * 0.25, vel=vel, gate=0.85, top=4)

    stab(2, [8, 11], EM9, 96)
    stab(4, [12, 14], EM9, 92)
    stab(6, [8, 11], B7, 98)
    stab(7, [0], C9V, 104, dur=3)
    stab(7, [6], C9V, 92)
    stab(8, [0, 6], B7S9, 100)
    stab(8, [12, 14], B7S9, 108)
    stab(10, [8, 11], EM69, 96)
    stab(12, [8, 11], AM6, 96)
    stab(14, [12, 14], EM, 94)
    stab(15, [0, 6], FSO, 96, dur=5)
    stab(15, [12], FSO, 98, dur=3)
    stab(16, [0], B7B9, 100, dur=5)
    stab(16, [6], B7B9, 100, dur=3)
    stab(16, [10, 12], B7B9, 104)
    stab(16, [14], B7B9, 112, dur=2)
    # swells into the breakdown and into the climax
    brass.chord(B(24, 2), "A3 D#4 G4", 2.6, vel=92)
    brass.cc(B(24, 1.9), 11, 66)
    brass.ramp(11, B(24, 2), B(24, 4.5), 66, 127, step=0.125, curve=1.4)
    brass.chord(B(31), B7SUS, 4.0, vel=90, gate=1.0)
    brass.chord(B(32), B7FULL, 3.7, vel=98)
    brass.cc(B(30, 4.9), 11, 60)
    brass.ramp(11, B(31), B(32, 4.6), 60, 127, step=0.125, curve=1.3)
    stab(34, [8, 11], EM9, 102)
    stab(36, [8, 11], B7, 102)
    stab(38, [12, 14], EM, 100)
    stab(39, [0, 6, 12], C9V, 108, dur=3)
    stab(40, [0, 6], B7S9, 106, dur=3)
    stab(40, [10, 12], B7S9, 108)
    stab(40, [14], B7S9, 114, dur=2)
    stab(41, [0], "G4 B4 D#5 F#5", 110, dur=5)
    stab(42, [8, 11], EM6, 96)
    stab(47, [0, 6, 12], B7SUS, 108, dur=2)
    stab(48, [0, 6], B7FULL, 110, dur=2)
    brass.chord(B(48, 3), "A3 D#4 F#4 A4 D5", 1.9, vel=96)
    brass.cc(B(48, 2.9), 11, 80)
    brass.ramp(11, B(48, 3), B(48, 4.8), 80, 127, step=0.125)

    # ---- trumpet + horns
    bridge_mel = [
        (17, "G4:q F#4:dh"), (18, "E4:h G4:h"), (19, "C5:q B4:dh"), (20, "A4:h E4:h"),
        (21, "C5:q B4:dh"), (22, "A4:h C5:h"), (23, "C5:q E5:dh"), (24, "E5:q D#5:2.6"),
    ]
    for bar, line in bridge_mel:
        tpt.seq(B(bar), line, vel=94 + (bar - 17) * 1.5)
        horns.seq(B(bar), line, vel=90 + (bar - 17) * 1.5, tr=-12)
    for bar in (17, 19, 21, 23, 24):
        tpt.vibrato(B(bar, 2), B(bar, 4.8), depth=13, rate=5.5, delay=0.3)
    tpt.ramp(11, B(23), B(24, 4.6), 108, 127, step=0.25)
    # climax: the theme in octaves with the guitar
    for part, tonic, v in ((tpt, "E4", 106), (horns, "E3", 100)):
        ev = motif.play(part, B(33), tonic, "rise", hold=4.0, vel=v, accent=8)
        ev2 = motif.play(part, B(35), tonic, "answer", hold=2.75, vel=v + 2, accent=8)
        motif.play(part, B(37), tonic, "fall", hold=3.0, vel=v, accent=8)
        if part is tpt:
            tpt.vibrato(ev[-1][0] + 1.0, ev[-1][0] + 3.9, depth=14, rate=5.5)
            tpt.vibrato(ev2[5][0] + 0.4, ev2[5][0] + 2.7, depth=16, rate=5.5)
    tpt.seq(B(39), "E5:e> D5:q Bb4:e> G4:q E4:q", vel=106)
    tpt.seq(B(40), "D#4:dq F#4:e A4:q B4:q", vel=106)
    # coda: horn pads and trumpet answers
    horns.chord(B(41), "B2 B3", 8.0, vel=86)
    horns.chord(B(43), "E3 B3", 8.0, vel=84)
    horns.chord(B(45), "A3 E4", 8.0, vel=84)
    tpt.seq(B(44, 3), "B4:e G4:e E4:q", vel=92)
    tpt.seq(B(46, 3), "C5:e A4:e E4:q", vel=94)
    for pos in (0, 6, 12):
        tpt.note(B(47) + pos * 0.25, "A4", 0.5, 108, gate=0.7)
        horns.chord(B(47) + pos * 0.25, "B2 F#3", 0.5, vel=104, gate=0.7)
    for pos in (0, 6):
        tpt.note(B(48) + pos * 0.25, "B4", 0.5, 110, gate=0.7)
        horns.chord(B(48) + pos * 0.25, "B2 F#3", 0.5, vel=104, gate=0.7)

    # ---- tremolo strings
    TREM = [
        (9, 1, 8, "B5", 70), (11, 1, 8, "E5", 72), (13, 1, 8, "E5", 74), (15, 1, 8, "A5 C6", 80),
        (17, 1, 8, "B5", 72), (19, 1, 8, "E5 B5", 72), (21, 1, 8, "E5 A5", 74), (23, 1, 4, "E5 A5", 76),
        (24, 1, 1, "E5 A5", 80), (24, 2, 3, "D#5 A5", 84),
        (25, 1, 8, "B4", 70), (27, 1, 8, "D5", 74), (29, 1, 8, "B4 E5", 80), (31, 1, 4, "A4 F#5", 86),
        (32, 1, 4, "D#5 A5", 94),
        (33, 1, 10, "B4 B5", 96), (35, 3, 2, "A#5 E6", 96), (36, 1, 1, "A5 E6", 96), (36, 2, 3, "A5 D#6", 98),
        (37, 1, 8, "E5 E6", 94), (39, 1, 4, "Bb5 E6", 96), (40, 1, 4, "F#5 A5", 100),
        (41, 1, 8, "B5", 80), (43, 1, 8, "E5 B5", 80), (45, 1, 8, "E5 A5", 80), (47, 1, 4, "F#5 A5", 82),
        (48, 1, 4, "F#5 A5", 88),
    ]
    for bar, beat, dur, voicing, v in TREM:
        trem.chord(B(bar, beat), voicing, dur, vel=v)
    trem.cc(B(8, 4.5), 11, 70)
    trem.ramp(11, B(9), B(16, 4.5), 70, 120, step=0.5, curve=1.5)
    trem.ramp(11, B(17), B(18), 120, 96, step=0.25)
    trem.ramp(11, B(23), B(24, 4.5), 96, 127, step=0.25)
    trem.ramp(11, B(25), B(25, 2), 127, 62, step=0.25)
    trem.ramp(11, B(26), B(32, 4.6), 62, 127, step=0.5, curve=1.6)
    trem.ramp(11, B(41), B(42), 127, 104, step=0.25)
    trem.ramp(11, B(47), B(48, 4.6), 104, 127, step=0.25)

    # ---- timpani
    def roll(beat, n16, pitch, v0, v1):
        for i in range(n16):
            timp.note(beat + i * 0.25, pitch, 0.25, v0 + (v1 - v0) * i / max(1, n16 - 1), gate=1.0)

    for bar, pitch, v in ((1, "E2", 112), (5, "E2", 92), (7, "C3", 100), (8, "B2", 98),
                          (9, "E2", 106), (11, "A2", 98), (13, "E2", 98), (15, "F#2", 98), (16, "B2", 100),
                          (17, "C3", 96), (19, "A2", 92), (21, "F2", 94), (23, "B2", 94),
                          (25, "E2", 114), (33, "E2", 120), (41, "E2", 112), (43, "C3", 96), (45, "F2", 96)):
        timp.note(B(bar), pitch, 2.0, v)
    roll(B(8, 4), 4, "B2", 70, 104)
    roll(B(16, 3.5), 6, "B2", 64, 108)
    roll(B(24, 3), 8, "B2", 54, 112)
    for bar in range(26, 31):
        v = 56 + (bar - 26) * 6
        timp.note(B(bar), "E2", 1.0, v + 6)
        timp.note(B(bar) + 1.5, "E2", 1.0, v)
    for i in range(8):
        timp.note(B(31) + i * 0.5, "B2", 0.5, 72 + i * 2.5)
    roll(B(32), 16, "B2", 78, 120)
    for bar in range(33, 39):
        if bar != 33:
            timp.note(B(bar), "B2" if bar == 36 else "E2", 1.0, 104)
        timp.note(B(bar) + 3.5, "B2", 0.5, 92)
    timp.note(B(35, 3), "F#2", 1.0, 100)
    for pos in (0, 6, 12):
        timp.note(B(39) + pos * 0.25, "C3", 0.75, 106)
        timp.note(B(47) + pos * 0.25, "B2", 0.75, 108)
    for pos in (0, 6, 10, 12, 14):
        timp.note(B(40) + pos * 0.25, "B2", 0.5, 104 + pos)
    for pos in (0, 6):
        timp.note(B(48) + pos * 0.25, "B2", 0.75, 110)
    roll(B(48, 3), 8, "B2", 70, 120)

    # ---- orchestra hits and the bell
    def bang(beat, pitch, v=108):
        hit.chord(beat, [n(pitch), n(pitch) + 12], 0.75, vel=v)

    bang(B(1), "E3", 104)
    bang(B(9), "E3", 100)
    for bar, tones in ((33, ("E3", "G3", "B3")), (35, ("G3", "B3", "E4")), (37, ("B3", "G3", "E3"))):
        for pos, p in zip((0, 6, 12), tones):
            bang(B(bar) + pos * 0.25, p, 110 if pos == 0 else 100)
    bang(B(39), "C3", 110)
    bang(B(40), "B2", 108)
    bang(B(41), "E3", 110)
    for pos in (0, 6, 12):
        bang(B(47) + pos * 0.25, "B2", 108)
    for pos in (0, 6):
        bang(B(48) + pos * 0.25, "B2", 110)
    bell.chord(B(33), "B3 B4", 4.0, vel=98)        # the 5th: clear of the 1 -> 7 slip
    bell.chord(B(37), "E3 E4", 4.0, vel=98)
    bell.chord(B(41), "B3 B4", 4.0, vel=96)
    bell.note(B(25), "E3", 6.0, 92)
    return s
