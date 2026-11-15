"""MINI-BOSS -- "Regional Manager".

C minor, 132 BPM, 36 bars (65.5 s).  A huge, polite, murderous mech: heavy
and menacing rather than fast.  Timpani and taiko ostinatos on the tresillo,
contrabass + tuba underneath, trombones and horns carrying the theme's DARK
forms (the fifth flattened, the slips climbing a diminished-7th chord),
orchestra hits, metallic clanks (agogo, ride bell, china), tremolo strings,
pizzicato ostinato, a choir pad and tubular-bell tolls.

  bars  1- 4  intro   timpani/taiko ostinato, tremolo strings with a rising
                      chromatic inner voice G-Ab-A-Bb (the line cliche) that
                      lands on B, the major 7th, as the theme enters
        5-12  A       DARK on C (trombones + horns): Cm(maj9) - Ab7#11 | DARK2:
                      D7alt | DARK on F: Fm(maj9) - Db7#11 | G7b9 hits
       13-20  B       "the march": tuba + trombones play the theme augmented
                      (DARK, DARK2 at half speed) under a pizzicato ostinato;
                      Cm(maj7) - Gbmaj7#11 (tritone) - Ebm(maj9) - F7 - G7b9
       21-28  C       breakdown on a C pedal with a Cm - Fm/C choir pad,
                      bell tolls and metal; build over Ab7#11 - Dbmaj7#11 - G7b9
                      with tremolo strings climbing and a snare/timpani roll
       29-34  D       climax: the DARK forms in three octaves (trumpets, horns,
                      trombones), orchestra hits on the tresillo, full drums
       35-36  turn    G7b9 hammer blows, timpani roll back to bar 1
"""
from __future__ import annotations

from emg.seq import Song
from emg.theory import n

from . import motif

BPM = 132
BARS = 36

CHORDS = {
    1: "Cm", 2: "Cm(b6)", 3: "Cm6", 4: "Cm7",
    5: "Cm(maj9)", 6: "Ab7#11", 7: "D7alt", 8: "D7alt", 9: "Fm(maj9)", 10: "Db7#11",
    11: "G7b9", 12: "G7alt",
    13: "Cm(maj7)", 14: "Cm(maj7)", 15: "Gbmaj7#11", 16: "Gbmaj7#11", 17: "Ebm(maj9)",
    18: "Ebm(maj9)", 19: "F7", 20: "G7b9",
    21: "Cm", 22: "Fm/C", 23: "Cm", 24: "Fm/C", 25: "Ab7#11", 26: "Ab7#11", 27: "Dbmaj7#11",
    28: "G7b9",
    29: "Cm(maj9)", 30: "Ab7#11", 31: "D7alt", 32: "D7alt", 33: "Fm(maj9)", 34: "Db7#11",
    35: "G7b9", 36: "G7alt",
}

# bass root per bar (MIDI; G1..Gb2, fundamentals 49-92 Hz)
_R = {"C": 36, "Db": 37, "D": 38, "Eb": 39, "F": 41, "Gb": 42, "G": 31, "Ab": 32}
ROOTS = {
    1: "C", 2: "C", 3: "C", 4: "C", 5: "C", 6: "Ab", 7: "D", 8: "D", 9: "F", 10: "Db",
    11: "G", 12: "G", 13: "C", 14: "C", 15: "Gb", 16: "Gb", 17: "Eb", 18: "Eb", 19: "F",
    20: "G", 21: "C", 22: "C", 23: "C", 24: "C", 25: "Ab", 26: "Ab", 27: "Db", 28: "G",
    29: "C", 30: "Ab", 31: "D", 32: "D", 33: "F", 34: "Db", 35: "G", 36: "G",
}
# timpani pitch per bar (a 4-drum set: G2 Ab2 C3 D3/Db3, F2)
TIMP = {"C": "C3", "Ab": "Ab2", "D": "A2", "F": "F2", "Db": "Db3", "G": "G2", "Gb": "Gb2",
        "Eb": "Eb3"}
TIMP5 = {"C": "G2", "Ab": "Eb3", "D": "D3", "F": "C3", "Db": "Ab2", "G": "D3", "Gb": "Db3",
         "Eb": "Bb2"}
# march (B): two strokes per bar, kept off the semitone neighbours of the low-brass theme
TIMP_B = {13: ("C3", "G2"), 14: ("G2", "G2"), 15: ("Gb2", "Db3"), 16: ("Gb2", "Db3"),
          17: ("Eb3", "Bb2"), 18: ("Bb2", "Bb2"), 19: ("F2", "C3"), 20: ("G2", None)}

# tremolo strings: (bar, beat, beats, voicing, velocity)
TREM = [
    (1, 1, 4, "G4 C5", 70), (2, 1, 4, "Ab4 C5", 74), (3, 1, 4, "A4 C5", 78), (4, 1, 4, "Bb4 C5", 84),
    (5, 1, 4, "B4 D5", 86), (6, 1, 4, "Gb4 C5", 84), (7, 1, 8, "A4 C5", 84),
    (9, 1, 3, "C5", 82), (9, 4, 1, "D5", 84), (10, 1, 4, "F4 Cb5", 84), (11, 1, 4, "F4 B4 D5", 90), (12, 1, 4, "F4 Ab4 Db5", 96),
    (13, 1, 8, "G5 B5", 70), (15, 1, 8, "F5 Bb5", 72), (17, 1, 8, "F5 D6", 74), (19, 1, 4, "Eb5 A5", 78),
    (20, 1, 4, "F5 Ab5 B5", 84),
    (25, 1, 4, "Gb4 C5", 66), (26, 1, 4, "Gb4 D5", 72), (27, 1, 4, "F4 G5", 80), (28, 1, 4, "B4 D5 F5", 90),
    # 29-34: the tremolo doubles the theme (see build)
    (35, 1, 4, "F5 Ab5 B5", 100), (36, 1, 4, "F5 Ab5 Db6", 104),
]

# pizzicato ostinato for the march (eight eighths per bar)
PIZZ = {
    13: "G3 C4 Eb4 G4 B4 G4 Eb4 C4", 14: "G3 C4 Eb4 G4 D5 B4 G4 Eb4",
    15: "F3 Bb3 Db4 F4 C5 F4 Db4 Bb3", 16: "F3 Bb3 Db4 F4 Bb4 F4 Db4 C4",
    17: "Gb3 Bb3 D4 F4 Bb4 F4 D4 Bb3", 18: "Gb3 Bb3 D4 Gb4 F4 D4 Bb3 Gb3",
    19: "A3 C4 Eb4 F4 A4 F4 Eb4 C4", 20: "B3 D4 F4 Ab4 B4 Ab4 F4 D4",
    21: "G3 C4 G3 C4 G3 C4 G3 C4", 22: "Ab3 C4 Ab3 C4 Ab3 C4 Ab3 C4",
    23: "G3 C4 G3 C4 G3 C4 G3 C4", 24: "Ab3 C4 Ab3 C4 F4 C4 Ab3 F3",
}

# brass-section / trumpet voicings for the hits
HIT = {
    "Cm7": "Eb4 G4 Bb4", "Cm(maj9)": "Eb4 G4 B4 D5", "Ab7#11": "C4 Gb4 D5", "D7alt": "F#4 C5 F5", "Fm(maj9)": "Ab4 C5 E5 G5",
    "Db7#11": "F4 Cb5 G5", "G7b9": "F4 B4 Ab5", "G7alt": "F4 B4 Eb5 Ab5", "Cm(maj7)": "Eb4 G4 B4",
    "Gbmaj7#11": "F4 Bb4 C5", "Ebm(maj9)": "Gb4 D5 F5", "F7": "Eb4 A4 C5",
}


def build() -> Song:
    s = Song("boss", bpm=BPM, bars=BARS, key="C minor")
    s.chords = dict(CHORDS)
    for bar, label in ((1, "intro"), (5, "A dark theme"), (13, "B march"), (21, "C breakdown/build"),
                       (29, "D climax"), (35, "turnaround")):
        s.section(bar, label)
    B = s.bar

    lowstr = s.part("lowstr", 43, level=-10.0, rev=40, vel=100, gate=0.9, human_ms=6, human_vel=4,
                    lay_ms=-30, lo="G1", hi="C3", role="bass", lp=3500)
    tuba = s.part("tuba", 58, level=-13.0, rev=55, vel=98, gate=0.92, human_ms=6, human_vel=4,
                  lay_ms=-20, pan=0.08, lo="F1", hi="F3", role="bass", lp=3000)
    tbn = s.part("trombones", 57, level=-9.5, rev=78, vel=100, gate=0.95, human_ms=6, human_vel=4,
                 lay_ms=-16, pan=-0.2, lo="E2", hi="F4", role="lead")
    horns = s.part("horns", 60, level=-12.0, rev=88, vel=96, gate=0.98, human_ms=7, human_vel=4,
                   lay_ms=-40, pan=0.25, lo="B2", hi="F5", hp=110)
    tpt = s.part("brass", 61, level=-10.5, rev=82, vel=100, gate=0.92, human_ms=6,
                 human_vel=4, lay_ms=-14, pan=0.12, lo="E3", hi="C6", role="lead")
    trem = s.part("tremolo", 44, level=-14.0, rev=90, vel=84, gate=1.0, human_ms=10, human_vel=3,
                  lay_ms=-80, pan=-0.24, lo="E4", hi="D6", hp=260)
    pizz = s.part("pizz", 45, level=-15.0, rev=66, vel=86, gate=0.5, human_ms=6, human_vel=6,
                  lay_ms=-30, pan=0.3, lo="F3", hi="D5", hp=180)
    choir = s.part("choir", 52, level=-17.0, rev=92, vel=72, gate=1.0, human_ms=10, human_vel=3,
                   lay_ms=-90, pan=0.0, lo="F3", hi="Ab4", hp=160, lp=7000)
    timp = s.part("timpani", 47, level=-10.5, rev=72, vel=104, gate=1.0, human_ms=4, human_vel=4,
                  pan=-0.08, lo="F2", hi="Eb3", role="perc", hp=45)
    taiko = s.part("taiko", 116, level=-12.0, rev=60, vel=104, gate=1.0, human_ms=4, human_vel=5,
                   pan=0.1, lo="C2", hi="C4", role="fx", hp=45)
    hit = s.part("orchhit", 55, level=-10.0, rev=78, vel=108, gate=1.0, human_ms=3, human_vel=3,
                 lay_ms=-14, lo="G2", hi="Ab5", role="perc")
    kit = s.part("kit", 8, drum=True, level=-11.0, rev=40, space="room", human_ms=3.5,
                 human_vel=5, role="perc", clip_db=2.5)
    cym = s.part("cym", 8, drum=True, level=-17.0, rev=46, space="room", human_ms=5,
                 human_vel=6, pan=-0.15, role="perc")
    metal = s.part("metal", 0, drum=True, level=-18.0, rev=58, space="room", human_ms=4,
                   human_vel=6, pan=0.32, role="perc")
    clank = s.part("clank", 113, level=-19.0, rev=70, vel=96, gate=0.6, human_ms=4, human_vel=6,
                   pan=-0.36, lo="C3", hi="C5", role="perc", hp=200)
    bell = s.part("bell", 14, level=-16.0, rev=96, vel=96, gate=1.0, human_ms=3, human_vel=3,
                  pan=0.28, lo="C3", hi="G5", role="perc")

    # ================================================================ bass: contrabass + tuba
    for bar in range(1, BARS + 1):
        r = _R[ROOTS[bar]]
        b = B(bar)
        if 13 <= bar <= 20:                     # march: the tuba's augmented theme is the bass line
            if bar in (19, 20):
                lowstr.note(b, r, 4.0, 96)
            continue
        if bar >= 35:
            continue
        soft = 21 <= bar <= 24
        v = 88 if soft else 102
        # tresillo: dotted quarter, dotted quarter, quarter (octave pop on the "2")
        lowstr.note(b, r, 1.5, v + 6, gate=0.86)
        lowstr.note(b + 1.5, r, 1.5, v - 6, gate=0.86)
        lowstr.note(b + 3.0, r + 12 if r + 12 <= n("C3") else r, 1.0, v, gate=0.8)
    # turnaround: hammer blows on G
    for beat in (1, 2, 3, 4):
        lowstr.note(B(35, beat), "G1", 1.0, 110, gate=0.6)
        tuba.note(B(35, beat), "G1", 1.0, 108, gate=0.6)
    lowstr.note(B(36), "G1", 4.0, 104)
    tuba.note(B(36), "G1", 4.0, 100)
    tuba.ramp(11, B(36), B(36, 4.6), 70, 127, step=0.125, curve=1.3)
    # tuba: downbeat weight in A and D, the theme in B
    for bar in list(range(5, 13)) + list(range(29, 35)):
        tuba.note(B(bar), _R[ROOTS[bar]], 1.5, 100, gate=0.8)

    # ================================================================ the theme
    def low_theme(part, bar, beat, tonic, form, hold, vel, stretch=1.0):
        return motif.play(part, B(bar, beat), tonic, form, hold=hold, stretch=stretch, vel=vel,
                          accent=10, long_vel=4)

    # A: trombones + horns an octave apart
    for part, octv, v in ((tbn, 0, 102), (horns, 12, 94)):
        low_theme(part, 5, 1, n("C3") + octv, "dark", 5.0, v)
        low_theme(part, 7, 1, n("C3") + octv, "dark2", 5.0, v + 2)
        low_theme(part, 9, 1, n("F3") + octv, "dark", 5.0, v + 2)
    tbn.ramp(11, B(6), B(6, 4.5), 110, 127, step=0.25)
    tbn.ramp(11, B(10), B(10, 4.5), 110, 127, step=0.25)
    # B: the march -- augmented theme in tuba + trombones (octaves)
    for part, tonic, v in ((tuba, "C2", 100), (tbn, "C3", 98)):
        low_theme(part, 13, 3, tonic, "dark", 7.0, v, stretch=2.0)
        low_theme(part, 17, 3, tonic, "dark2", 7.5, v + 4, stretch=2.0)
    # horns answer the march with the slips in the gaps
    horns.seq(B(16), "r:h Db4:e> C4:dq", vel=92)      # over the held Gb: 5 -> #11
    horns.chord(B(19), "Eb3 A3", 4.0, vel=90)
    horns.chord(B(20), "F3 B3", 4.0, vel=96)
    # D: three octaves
    for part, octv, v in ((tpt, 24, 104), (horns, 12, 100), (tbn, 0, 106), (trem, 24, 92)):
        ev = low_theme(part, 29, 1, n("C3") + octv, "dark", 5.0, v)
        low_theme(part, 31, 1, n("C3") + octv, "dark2", 5.0, v + 2)
        low_theme(part, 33, 1, n("F3") + octv, "dark", 5.0, v + 2)
        if part is tpt:
            for bar in (30, 32, 34):
                tpt.vibrato(B(bar), B(bar, 4.6), depth=12, rate=5.2, delay=0.2)

    # ================================================================ brass hits + trumpets
    def stab(part, bar, positions, chord, vel=104, dur=1.5, step=0.25):
        for pos in positions:
            part.chord(B(bar) + pos * step, HIT[chord], dur * step, vel=vel, gate=0.85, top=4)

    stab(tpt, 4, [12, 14], "Cm7", 92)
    stab(tpt, 6, [8, 11], "Ab7#11", 98)
    stab(tpt, 8, [8, 11, 14], "D7alt", 100)
    stab(tpt, 10, [8, 11], "Db7#11", 100)
    for pos in (0, 6, 12):
        stab(tpt, 11, [pos], "G7b9", 108, dur=3)
    tpt.chord(B(12), HIT["G7alt"], 3.7, vel=96)
    tpt.cc(B(11, 4.9), 11, 60)
    tpt.ramp(11, B(12), B(12, 4.6), 60, 127, step=0.125, curve=1.4)
    for bar, chord in ((13, "Cm(maj7)"), (15, "Gbmaj7#11"), (17, "Ebm(maj9)")):
        stab(tpt, bar, [0, 6], chord, 96, dur=2)
    stab(tpt, 19, [0, 6, 12], "F7", 100, dur=2)
    stab(tpt, 20, [0, 6, 10, 12, 14], "G7b9", 106, dur=1.5)
    # build
    tpt.chord(B(27), HIT["Db7#11"].replace("Cb5", "C5"), 4.0, vel=90, gate=1.0)
    tpt.cc(B(26, 4.9), 11, 56)
    tpt.ramp(11, B(27), B(28, 1), 56, 127, step=0.125, curve=1.5)
    stab(tpt, 28, [0, 3, 6, 8, 10, 12, 14], "G7b9", 108, dur=1.4)
    # turnaround
    for beat in (1, 2, 3, 4):
        tpt.chord(B(35, beat), HIT["G7b9"], 0.6, vel=112, gate=0.8)
        horns.chord(B(35, beat), "G3 D4", 0.6, vel=106, gate=0.8)
        tbn.chord(B(35, beat), "G2 F3", 0.6, vel=110, gate=0.8)
    tpt.chord(B(36), HIT["G7alt"], 3.7, vel=94)
    tpt.cc(B(35, 4.9), 11, 52)
    tpt.ramp(11, B(36), B(36, 4.6), 52, 127, step=0.125, curve=1.4)
    tbn.chord(B(36), "G2 B2 F3", 3.7, vel=96)
    tbn.cc(B(35, 4.9), 11, 60)
    tbn.ramp(11, B(36), B(36, 4.6), 60, 127, step=0.125, curve=1.4)
    # breakdown: trombone growls (a slow fall on the pedal)
    for bar in (21, 23):
        tbn.note(B(bar, 3), "C3", 2.0, 92)
        tbn.glide(B(bar + 1, 0.5), B(bar + 1, 0.95), 0, -150, curve=1.4, after=0)
    # build: trombones swell on the bVI7 and bII
    tbn.chord(B(25), "Ab2 Gb3", 8.0, vel=86)
    tbn.cc(B(24, 4.9), 11, 64)
    tbn.ramp(11, B(25), B(26, 4.5), 64, 127, step=0.25, curve=1.3)
    tbn.chord(B(27), "Db3 F3", 4.0, vel=96)
    tbn.chord(B(28), "G2 F3", 4.0, vel=104)
    horns.chord(B(25), "C4 Gb4", 8.0, vel=84)
    horns.chord(B(27), "C4 F4", 4.0, vel=90)
    horns.chord(B(28), "B3 F4", 4.0, vel=98)

    # ================================================================ strings
    for bar, beat, dur, voicing, v in TREM:
        trem.chord(B(bar, beat), voicing, dur, vel=v)
    trem.cc(B(1), 11, 80)
    trem.ramp(11, B(1), B(4, 4.5), 80, 120, step=0.5, curve=1.2)
    trem.ramp(11, B(13), B(14), 96, 110, step=0.5)
    trem.ramp(11, B(25), B(28, 4.6), 70, 127, step=0.5, curve=1.5)
    trem.cc(B(29), 11, 120)
    trem.ramp(11, B(35), B(36, 4.6), 110, 127, step=0.25)
    for bar, cell in PIZZ.items():
        notes = cell.split()
        quiet = 21 <= bar <= 24
        for i, p in enumerate(notes):
            v = (72 if quiet else 86) + (10 if i in (0, 3, 6) else 0)
            pizz.note(B(bar) + i * 0.5, p, 0.5, v)

    # choir: breakdown pad and climax weight
    for bar, voicing in ((21, "G3 C4 Eb4"), (22, "Ab3 C4 F4"), (23, "G3 C4 Eb4"), (24, "Ab3 C4 F4")):
        choir.chord(B(bar), voicing, 4.0, vel=70)
    # climax: only under the theme's held notes (its slips would rub against a sustained chord)
    for bar, voicing in ((30, "Gb3 C4 Eb4"), (32, "F#3 A3 C4"), (34, "F3 Ab3 Cb4")):
        choir.chord(B(bar), voicing, 4.0, vel=82)
    choir.cc(B(20, 4.5), 11, 90)
    choir.ramp(11, B(21), B(22), 90, 116, step=0.25)
    choir.ramp(11, B(29), B(29, 2), 116, 127, step=0.25)

    # ================================================================ timpani + taiko
    def roll(beat, n16, pitch, v0, v1):
        for i in range(n16):
            timp.note(beat + i * 0.25, pitch, 0.25, v0 + (v1 - v0) * i / max(1, n16 - 1), gate=1.0)

    for bar in range(1, BARS + 1):
        root = ROOTS[bar]
        tp = TIMP[root]
        b = B(bar)
        if bar <= 12 or 29 <= bar <= 34:
            v = 96 + (4 if bar >= 29 else 0) - (8 if bar <= 2 else 0)
            # tresillo with a sixteenth pickup into the third stroke
            timp.note(b, tp, 1.0, v + 10)
            timp.note(b + 1.5, tp, 1.0, v - 4)
            t5 = TIMP5[root]
            timp.note(b + 2.75, t5, 0.25, v - 16)
            timp.note(b + 3.0, t5, 1.0, v)
        elif 13 <= bar <= 20:
            p1, p2 = TIMP_B[bar]
            timp.note(b, p1, 1.0, 92)
            if p2:
                timp.note(b + 2.0, p2, 1.0, 80)
        elif 21 <= bar <= 24:
            timp.note(b, "C3", 1.0, 84 + (bar - 21) * 3)
            timp.note(b + 1.5, "C3", 1.0, 70)
            timp.note(b + 3.0, "G2" if bar % 2 else "F2", 1.0, 76)
        elif 25 <= bar <= 27:
            for i in range(4):
                timp.note(b + i, tp, 1.0, 76 + (bar - 25) * 6 + i * 2)
    roll(B(12, 3), 8, "G2", 60, 112)
    roll(B(20, 3), 8, "G2", 60, 108)
    roll(B(28), 16, "G2", 64, 118)
    for beat in (1, 2, 3, 4):
        timp.note(B(35, beat), "G2", 1.0, 116)
    roll(B(36), 16, "G2", 56, 120)

    # taiko: the stomp -- beat 1 and the "and" of 2 in A/D, every bar's downbeat in B
    for bar in range(1, BARS + 1):
        b = B(bar)
        if 5 <= bar <= 12 or 29 <= bar <= 34:
            taiko.note(b, "C3", 1.0, 108)
            taiko.note(b + 1.5, "G2", 1.0, 92)
            if bar % 2 == 0:
                taiko.seq(b + 3, "C3:s G2:s G2:s C3:s", vel=86)
        elif 13 <= bar <= 20:
            taiko.note(b, "C3", 2.0, 100)
            taiko.note(b + 2.0, "G2", 1.0, 84)
        elif 21 <= bar <= 24:
            taiko.note(b, "G2", 2.0, 96)
        elif 25 <= bar <= 28:
            for i in range(4):
                taiko.note(b + i, "C3", 1.0, 80 + (bar - 25) * 5)
    for beat in (1, 2, 3, 4):
        taiko.note(B(35, beat), "C3", 1.0, 116)

    # ================================================================ orchestra hits + bells
    def bang(beat, pitch, v=108):
        hit.chord(beat, [n(pitch), n(pitch) + 12], 0.75, vel=v)

    for bar, p in ((5, "C3"), (29, "C3"), (31, "A2")):
        for pos, dv in zip((0, 6, 12), (4, -6, -4)):
            bang(B(bar) + pos * 0.25, p, 108 + dv)
    for bar in (9, 33):                     # on F, then the b3 under the theme's held Cb
        bang(B(bar), "F3", 112)
        bang(B(bar, 4), "Ab2", 104)
    bang(B(6), "Ab2", 104)
    bang(B(7), "A2", 106)
    bang(B(10), "Db3", 104)
    for pos in (0, 6, 12):
        bang(B(11) + pos * 0.25, "G2", 110)
    bang(B(13), "C3", 104)
    bang(B(15), "Db3", 102)
    bang(B(17), "Eb3", 102)
    bang(B(21), "C3", 96)
    bang(B(23), "C3", 92)
    for pos in (0, 6, 12):
        bang(B(28) + pos * 0.25, "G2", 108)
    for beat in (1, 2, 3, 4):
        bang(B(35, beat), "G2", 112)
    bell.chord(B(21), "C3 C4", 6.0, vel=96)
    bell.chord(B(23), "C3 C4", 6.0, vel=92)
    bell.chord(B(30), "C4 C5", 4.0, vel=98)
    bell.chord(B(34), "F3 F4", 4.0, vel=96)
    bell.note(B(13), "G4", 4.0, 90)
    bell.note(B(17), "Bb3", 4.0, 90)

    # ================================================================ drums, cymbals, metal
    HALF = {"kick": "x.....x.........", "snare": "........x......."}
    HALF2 = {"kick": "x.....x...x.....", "snare": "........x.....,,"}
    MARCH = {"kick": "x.......x.......", "snare": "x.,,o.,.x.,,o.x."}
    FULL = {"kick": "x.....x.x.....x.", "snare": "....x.......x..,"}
    FULL2 = {"kick": "x.....x.x..x..x.", "snare": "....x.......x.,,"}
    for bar in range(1, BARS + 1):
        b = B(bar)
        if bar <= 4:
            if bar >= 3:
                kit.drums(b, HALF, vel_scale=0.8)
        elif bar <= 12:
            kit.drums(b, HALF if bar % 2 else HALF2)
        elif bar <= 20:
            kit.drums(b, MARCH, vel_scale=0.9)
        elif bar <= 24:
            kit.hits(b, "x...............", "kick", vel_scale=0.8)
        elif bar <= 26:
            kit.hits(b, "x.......x.......", "kick", vel_scale=0.9)
            kit.hits(b, "....o.......o...", "snare", vel_scale=0.8)
        elif bar == 27:
            kit.hits(b, "o.o.o.o.x.x.x.x.", "snare")
            kit.hits(b, "x...x...x...x...", "kick")
        elif bar == 28:
            kit.hits(b, "ooooxxxxxxxxXXXX", "snare")
            kit.hits(b, "x...x...x...x.x.", "kick")
        elif bar <= 34:
            kit.drums(b, FULL if bar % 2 else FULL2)
    kit.drums(B(12), {"snare": "........x.o.xxxx", "tom_l": "............x...", "tom_f2": "..............xx"})
    kit.drums(B(20), {"tom_h": "........xx......", "tom_l": "..........xx....", "tom_f2": "............xxxx"})
    for beat in (1, 2, 3, 4):
        kit.note(B(35, beat), 36, 0.25, 118)
        kit.note(B(35, beat), 38, 0.25, 116)
    kit.hits(B(36), ",,,,gggg----oooo", "snare")
    kit.hits(B(36), "............x.xX", "tom_f2")

    for bar, v in ((5, 110), (13, 100), (21, 96), (29, 118), (33, 104)):
        cym.note(B(bar), 49, 2.0, v)
    cym.note(B(9), 57, 2.0, 100)
    cym.note(B(11), 52, 2.0, 102)
    cym.note(B(31), 52, 2.0, 106)
    for beat in (1, 2, 3, 4):
        cym.note(B(35, beat), 52 if beat % 2 else 57, 1.0, 108)
    for bar in list(range(29, 35)):
        cym.hits(B(bar), "x.o.x.o.x.o.x.o.", "ride", vel_scale=0.75)

    # metal: the machine's joints -- ride bell, low agogo, china chokes
    for bar in range(1, BARS + 1):
        b = B(bar)
        if bar <= 4 or 21 <= bar <= 24:
            metal.hits(b, "..o.....o..x....", "bell", vel_scale=0.85)
            metal.hits(b, ".......x.......o", "agogo_l", vel_scale=0.9)
        elif bar <= 12 or 29 <= bar <= 34:
            metal.hits(b, "....x.......x...", "bell", vel_scale=0.9)
            metal.hits(b, "..o...o...o...o.", "agogo_l", vel_scale=0.8)
        elif bar <= 20:
            metal.hits(b, "x...o...x...o...", "bell", vel_scale=0.8)
            metal.hits(b, "......o.......o.", "tri_m", vel_scale=0.7)
        elif bar <= 28:
            metal.hits(b, "x.o.x.o.x.o.x.o.", "bell", vel_scale=0.6 + 0.08 * (bar - 25))
        else:                                   # turnaround: one clang per hammer blow
            metal.hits(b, "x...x...x...x..." if bar == 35 else "x...............", "bell")
    # pitched clanks: a dissonant pair of struck pipes (tritone apart)
    for bar in range(1, BARS + 1):
        b = B(bar)
        if bar <= 4 or 21 <= bar <= 24:
            clank.note(b + 0.75, "C4", 0.5, 92)
            clank.note(b + 2.25, "Gb3", 0.5, 84)
        elif 5 <= bar <= 12 or 29 <= bar <= 34:
            clank.note(b + 3.75, "C4", 0.25, 86)
    return s
