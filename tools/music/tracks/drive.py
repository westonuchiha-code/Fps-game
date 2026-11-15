"""VEHICLE RUN -- "Last Mile".

A minor, 148 BPM, 36 bars (58.4 s), straight eighths.  Driving surf-spy
rock for the Teamster and the Vesper: picked bass in eighths, power kit,
tambourine, palm-muted rhythm guitar, brass punches, and the twangy clean
lead guitar (whammy dips, scoops, vibrato) carrying the Clearance theme.

  bars  1- 4  intro   bass drive, tremolo-picked low A (the theme's 1 - b3 2 - 5
                      in slow motion), muted chugs, brass kick-off
        5-12  A       theme (guitar): Am(maj9) - Fmaj7#11 - E7 | Dm(maj9) - Dm6 -
                      Bb7#11 - E7#9; brass punches in the holes
       13-20  B       walking bass, ride, organ: Fmaj7#11 - G7sus - G7 - Cmaj7 -
                      A7b9 - Dm9 - E7#9; new guitar melody in a 3-bar sequence
       21-28  C       breakdown: floor-tom groove, low guitar riff, trumpet
                      calls; build over Dm9 - E7 with the trumpet's answer
       29-34  A'      theme in octaves (guitar + horn in unison, trumpet 8va), full kit
       35-36  turn    E7#9 stop-time punches, drum fill + bass run back to bar 1
"""
from __future__ import annotations

from emg.seq import Song

from . import motif

BPM = 148
BARS = 36

CHORDS = {
    1: "Am", 2: "Am", 3: "Am", 4: "E7#9",
    5: "Am(maj9)", 6: "Am(maj9)", 7: "Fmaj7#11", 8: "E7", 9: "Dm(maj9)", 10: "Dm6",
    11: "Bb7#11", 12: "E7#9",
    13: "Fmaj7#11", 14: "Fmaj7#11", 15: "G7sus", 16: "G7", 17: "Cmaj7", 18: "A7b9",
    19: "Dm9", 20: "E7#9",
    21: "Am", 22: "Am", 23: "Am", 24: "Am", 25: "Dm9", 26: "Dm9", 27: "E7", 28: "E7#9",
    29: "Am(maj9)", 30: "Am(maj9)", 31: "Fmaj7#11", 32: "E7", 33: "Dm(maj9)", 34: "Bb7#11",
    35: "E7#9", 36: "E7#9",
}

# bass roots (MIDI, kept between A1 and G#2 so the fundamental sits in 55-105 Hz)
ROOT = {"A": 33, "Bb": 34, "B": 35, "C": 36, "D": 38, "E": 40, "F": 41, "G": 43}
# bar -> (root, 3rd, 7th, pattern)
BASS_PLAN = {
    1: ("A", 3, 10, "drive"), 2: ("A", 3, 10, "drive2"), 3: ("A", 3, 10, "drive"),
    4: ("E", 4, 10, "drive2"),
    5: ("A", 3, 11, "drive"), 6: ("A", 3, 11, "drive2"), 7: ("F", 4, 11, "drive"),
    8: ("E", 4, 10, "drive2"), 9: ("D", 3, 11, "drive"), 10: ("D", 3, 9, "drive2"),
    11: ("Bb", 4, 10, "drive"), 12: ("E", 4, 10, "run"),
    13: ("F", 4, 11, "walk"), 14: ("F", 4, 11, "walk2"), 15: ("G", 5, 10, "walk"),
    16: ("G", 4, 10, "walk2"), 17: ("C", 4, 11, "walk"), 18: ("A", 4, 10, "walk2"),
    19: ("D", 3, 10, "walk"), 20: ("E", 4, 10, "drive2"),
    21: ("A", 3, 10, "pedal"), 22: ("A", 3, 10, "pedal"), 23: ("A", 3, 10, "pedal"),
    24: ("A", 3, 10, "pedal_up"),
    25: ("D", 3, 10, "drive"), 26: ("D", 3, 10, "drive2"), 27: ("E", 4, 10, "drive"),
    28: ("E", 4, 10, "run"),
    29: ("A", 3, 11, "drive"), 30: ("A", 3, 11, "drive2"), 31: ("F", 4, 11, "drive"),
    32: ("E", 4, 10, "drive2"), 33: ("D", 3, 11, "drive"), 34: ("Bb", 4, 10, "drive2"),
}
# velocity shape of a driving bar: push on 1, the "and" of 2 and beat 4
_DRV_V = [10, -12, 2, -6, 4, -12, 6, -4]

# palm-muted rhythm guitar voicings (mid register, above the bass, below the lead)
CHUG = {
    "Am": "A3 C4 E4", "Am(maj9)": "G#3 C4 E4", "E7#9": "G#3 D4 G4", "E7": "G#3 D4 E4",
    "Fmaj7#11": "A3 C4 E4", "Dm(maj9)": "A3 C#4 F4", "Dm6": "A3 B3 F4", "Bb7#11": "Ab3 D4 E4",
    "Dm9": "A3 C4 F4",
}

# brass-section voicings
BR = {
    "Am(maj9)": "C4 E4 G#4 B4", "Am": "C4 E4 A4", "Fmaj7#11": "A3 C4 E4 B4", "E7": "G#3 D4 F#4 B4",
    "E7#9": "G#3 D4 G4", "E7(13)": "G#3 D4 B4", "Dm(maj9)": "F3 A3 C#4 E4", "Dm6": "F3 B3 D4", "Bb7#11": "Ab3 D4 E4",
    "G7sus": "F3 C4 D4 G4", "G7": "F3 B3 D4", "Cmaj7": "E4 G4 B4", "A7b9": "G3 C#4 Bb4",
    "Dm9": "F3 C4 E4 A4",
}

# organ (B section only): sustained colour voicings
ORGAN = {
    13: "A3 C4 E4 B4", 14: "A3 C4 E4 B4", 15: "F3 C4 D4 G4", 16: "F3 B3 D4 G4",
    17: "E3 G3 B3 D4", 18: "G3 C#4 E4 Bb4", 19: "F3 A3 C4 D4", 20: "G#3 B3 D4",
}


def build() -> Song:
    s = Song("drive", bpm=BPM, bars=BARS, key="A minor")
    s.chords = dict(CHORDS)
    # the Power kit's crash (note 49) rings on past the 13 s between crashes, so its
    # voice state only repeats exactly from the third pass on: render one extra pass
    s.passes = 4
    for bar, label in ((1, "intro"), (5, "A theme"), (13, "B walk"), (21, "C breakdown/build"),
                       (29, "A' theme 8va"), (35, "turnaround")):
        s.section(bar, label)
    B = s.bar

    bass = s.part("bass", 34, level=-9.0, rev=0, vel=98, gate=0.84, human_ms=4, human_vel=4,
                  lo="E1", hi="A3", role="bass", lp=5000)
    kit = s.part("kit", 16, drum=True, level=-7.5, rev=30, space="room", human_ms=3.5,
                 human_vel=5, role="perc", clip_db=3.0)
    hats = s.part("hats", 16, drum=True, level=-18.5, rev=26, space="room", human_ms=4,
                  human_vel=6, pan=0.24, role="perc")
    cym = s.part("cym", 16, drum=True, level=-16.0, rev=40, space="room", human_ms=5,
                 human_vel=6, pan=-0.18, role="perc")
    tamb = s.part("tamb", 0, drum=True, level=-19.5, rev=34, space="room", human_ms=5,
                  human_vel=7, pan=-0.34, role="perc")
    gtr = s.part("guitar", 27, level=-6.5, rev=96, cho=40, vel=100, gate=0.95, human_ms=5,
                 human_vel=4, bend_range=3, pan=0.1, lo="E2", hi="E5", role="lead", hp=80)
    rhy = s.part("rhythm", 28, level=-15.5, rev=40, vel=88, gate=0.6, human_ms=5, human_vel=6,
                 pan=-0.3, lo="E3", hi="B4", hp=160)
    brass = s.part("brass", 61, level=-10.0, rev=78, vel=100, gate=0.85, human_ms=5,
                   human_vel=4, lay_ms=-22, pan=0.3, lo="E3", hi="G5")
    tpt = s.part("trumpet", 56, level=-10.0, rev=86, vel=98, gate=0.95, human_ms=7,
                 human_vel=4, lay_ms=-10, pan=-0.22, lo="E3", hi="C6", role="lead")
    horn = s.part("horn", 60, level=-14.5, rev=90, vel=92, gate=0.98, human_ms=8, human_vel=4,
                  lay_ms=-40, pan=-0.12, lo="B2", hi="F5", hp=110)
    organ = s.part("organ", 17, level=-16.5, rev=70, cho=40, vel=80, gate=1.0, human_ms=6,
                   human_vel=3, pan=0.2, lo="E3", hi="C5", hp=170, lp=7000)

    # ================================================================ bass
    def approach(r, nxt):
        if nxt == r:
            return r + 7          # same chord next bar: the fifth, no chromatic rub
        return nxt - 1

    for bar in range(1, 35):
        root, third, sev, kind = BASS_PLAN[bar]
        r = ROOT[root]
        nxt_root = BASS_PLAN.get(bar + 1, ("E", 0, 0, ""))[0]
        nx = ROOT[nxt_root]
        if kind == "drive":
            notes = [r, r, r + 12, r, r + 7, r, r + 12, approach(r, nx)]
        elif kind == "drive2":
            if third == 4:
                notes = [r, r, r + 7, r + 12, r + sev, r + 7, r + 4, approach(r, nx)]
            else:
                notes = [r, r, r + 7, r + 12, r + 7, r + 5, r + 3, approach(r, nx)]
        elif kind == "run":       # up the dominant arpeggio and back down
            notes = [r, r, r + 4, r + 7, r + 10, r + 7, r + 4, approach(r, nx)]
        elif kind == "pedal":     # tresillo accents on a pedal, octave pop on the "2"
            for i, (p, dv) in enumerate(zip([r, r, r, r, r, r, r + 12, r],
                                            [12, -18, -18, 8, -14, -16, 6, -10])):
                bass.note(B(bar) + i * 0.5, p, 0.5, 92 + dv, gate=0.7)
            continue
        elif kind == "pedal_up":
            notes = [r, r, r, r + 3, r + 5, r + 6, r + 7, nx - 1]
        if kind.startswith("walk"):
            # quarter-note walk with a ghosted pickup into beat 4
            line = [r, r + third if kind == "walk" else r + 7, r + 7 if kind == "walk" else r + 12,
                    approach(r, nx)]
            if kind == "walk2":
                line[2] = r + sev
            for i, p in enumerate(line):
                bass.note(B(bar) + i, p, 1.0, 96 + (8 if i == 0 else 0), gate=0.9)
            bass.note(B(bar, 3.5), line[2], 0.5, 62, gate=0.4)          # ghosted dead note
            continue
        for i, p in enumerate(notes):
            bass.note(B(bar) + i * 0.5, p, 0.5, 96 + _DRV_V[i])
    # turnaround: stop-time on E, then a run up to A
    for pos in (0, 3, 6):
        bass.note(B(35) + pos * 0.5, "E2", 0.5, 110, gate=0.7)
    bass.note(B(35, 4), "E2", 1.0, 104, gate=0.55)
    bass.seq(B(36), "E2:e> E2:e' r:q E2:e> F#2:e G#2:e B2:e", vel=100)

    # ================================================================ guitar lead
    def dip(beat, depth=-90.0, down=0.12, up=0.3):
        gtr.glide(beat, beat + down, 0, depth, curve=0.8)
        gtr.glide(beat + down, beat + down + up, depth, 0, curve=1.3, after=0)

    def scoop(beat, frm=-100.0, dur=0.18):
        gtr.bend(beat - 0.03, frm)
        gtr.glide(beat, beat + dur, frm, 0, curve=0.7, after=0)

    def vib(b0, b1, depth=22.0, rate=5.8):
        gtr.vibrato(b0, b1, depth=depth, rate=rate, delay=0.14, attack=0.3)

    # intro: tremolo-picked low strings, the theme's skeleton in slow motion
    for bar, pitches in ((1, ["A2"] * 16), (2, ["A2"] * 16), (3, ["C3"] * 8 + ["B2"] * 8)):
        for i, p in enumerate(pitches):
            v = 66 + (bar - 1) * 9 + i * 0.6 + (8 if i % 4 == 0 else 0)
            gtr.note(B(bar) + i * 0.25, p, 0.25, v, gate=0.9)
    gtr.note(B(4), "E3", 3.0, 102)
    vib(B(4, 1.5), B(4, 3.4), depth=26)
    gtr.glide(B(4, 3.4), B(4, 3.95), 0, -300, curve=1.6, after=0)      # dive off the E
    gtr.seq(B(4, 4), "E3:e A3:e", vel=90)

    # A: the theme
    ev = motif.play(gtr, B(5), "A3", "rise", hold=3.5, vel=102, accent=10)
    dip(ev[-1][0] + 0.05, depth=-60, down=0.1, up=0.22)
    vib(ev[-1][0] + 0.9, ev[-1][0] + 3.4)
    gtr.seq(B(6, 3.5), "B3:e C4:e D4:e", vel=88)
    ev = motif.play(gtr, B(7), "A3", "answer", hold=2.75, vel=104, accent=10)
    scoop(ev[4][0])
    vib(ev[5][0], ev[5][0] + 2.7, depth=24)
    ev = motif.play(gtr, B(9), "D4", "rise", hold=2.5, vel=102, accent=10)
    vib(ev[-1][0] + 0.6, ev[-1][0] + 2.4, depth=20)
    gtr.seq(B(10, 3.5), "G4:e F4:e D4:e", vel=92)
    gtr.seq(B(11), "F4:q> E4:e D4:e Ab4:h", vel=100)
    dip(B(11, 3.3), depth=-80)
    gtr.seq(B(12), "G4:dq F4:e E4:q D4:e B3:e", vel=98)
    scoop(B(12), frm=-100)

    # B: new melody, three-bar rhythmic sequence then a release
    b_mel = [
        (13, "C4:e E4:e A4:dq G4:e E4:q"), (14, "B4:h> A4:q E4:q"),
        (15, "D4:e F4:e C5:dq A4:e F4:q"), (16, "B4:h> G4:q D4:q"),
        (17, "E4:e G4:e B4:dq A4:e G4:q"), (18, "C#5:h> Bb4:q G4:q"),
        (19, "F4:e A4:e E5:dq D5:e A4:q"), (20, "G4:q> G#4:q B4:q D5:q"),
    ]
    for bar, line in b_mel:
        gtr.seq(B(bar), line, vel=96 + (bar - 13))
    for bar in (14, 16, 18):
        scoop(B(bar), frm=-100 if bar != 18 else -200, dur=0.2)
        vib(B(bar, 1.5), B(bar, 2.95), depth=22)
    for bar in (13, 15, 17, 19):
        dip(B(bar, 2.1), depth=-55, down=0.08, up=0.25)
    vib(B(19, 2.5), B(19, 3.4), depth=18)
    scoop(B(20, 2), frm=-100)                                   # G -> G#: the #9 bends to the 3rd

    # C: low riff in the breakdown, long bent notes in the build
    riff = "A2:e' A2:e' C3:e E3:e G3:e' E3:e' D#3:e D3:e"
    for bar in (21, 22, 23):
        gtr.seq(B(bar), riff, vel=80 + (bar - 21) * 4)          # breakdown: back off, then build
    gtr.seq(B(24), "A2:e' A2:e' C3:e E3:e A3:e' C4:e' D#4:e E4:e", vel=94)
    gtr.note(B(25), "A3", 3.5, 92)
    vib(B(25, 2), B(25, 4.4), depth=20)
    gtr.note(B(27), "G#3", 3.5, 98)
    scoop(B(27), frm=-200, dur=0.3)
    vib(B(27, 2), B(27, 4.4), depth=24)
    gtr.note(B(28), "E4", 3.0, 104)
    vib(B(28, 1.3), B(28, 3.3), depth=30, rate=6.2)
    gtr.glide(B(28, 3.3), B(28, 3.95), 0, -300, curve=1.5, after=0)
    gtr.seq(B(28, 4), "E3:e A3:e", vel=96)

    # A': the theme again, octave doubled by the horn
    for part, tonic, v in ((gtr, "A3", 108), (horn, "A3", 96)):
        ev = motif.play(part, B(29), tonic, "rise", hold=3.5, vel=v, accent=10)
        ev2 = motif.play(part, B(31), tonic, "answer", hold=2.75, vel=v + 2, accent=10)
        ev3 = motif.play(part, B(33), "D4", "rise", hold=2.5, vel=v, accent=10)
        if part is gtr:
            dip(ev[-1][0] + 0.05, depth=-60, down=0.1, up=0.22)
            vib(ev[-1][0] + 0.9, ev[-1][0] + 3.4, depth=24)
            scoop(ev2[4][0])
            vib(ev2[5][0], ev2[5][0] + 2.7, depth=26)
            vib(ev3[-1][0] + 0.6, ev3[-1][0] + 2.4, depth=22)
    gtr.seq(B(30, 3.5), "B3:e C4:e D4:e", vel=92)
    gtr.seq(B(34), "F4:q> E4:e D4:e Ab4:h", vel=104)
    dip(B(34, 3.3), depth=-90)
    # turnaround: stabs with the band, then the big dive back to the top
    for pos in (0, 3, 6):
        gtr.note(B(35) + pos * 0.5, "E3", 0.5, 108, gate=0.6)
    gtr.note(B(35, 4), "B3", 1.0, 104, gate=0.6)
    gtr.note(B(36, 2), "E4", 2.0, 106)
    vib(B(36, 2.2), B(36, 3.3), depth=30, rate=6.4)
    gtr.glide(B(36, 3.3), B(36, 4.6), 0, -350, curve=1.4, after=0)

    # ================================================================ trumpet + horn
    # breakdown calls: the "slip" (a semitone fall) tossed between trumpet and horn
    calls = [(21, 3, "E5:e D#5:q"), (22, 3, "G5:e F#5:q"), (23, 3, "C5:e B4:q"),
             (24, 2, "E5:e D#5:e E5:q A5:q")]
    for bar, beat, line in calls:
        tpt.seq(B(bar, beat), line, vel=94 + (bar - 21) * 2)
    tpt.vibrato(B(24, 3.5), B(24, 4.9), depth=14, rate=5.5, delay=0.1)
    # build: the theme's answer over Dm9 -> E7
    ev = motif.play(tpt, B(25, 3), "A4", "answer", hold=4.5, vel=100, accent=8)
    tpt.vibrato(ev[5][0] + 0.3, ev[5][0] + 4.4, depth=16, rate=5.5)
    tpt.ramp(11, B(26, 2), B(27, 4.8), 96, 127, step=0.25)
    tpt.seq(B(28), "B4:e> D5:e r:e G5:e G#5:h", vel=106)
    # A': trumpet doubles the guitar an octave up
    ev = motif.play(tpt, B(29), "A4", "rise", hold=3.5, vel=102, accent=8)
    tpt.vibrato(ev[-1][0] + 0.8, ev[-1][0] + 3.4, depth=14, rate=5.5)
    ev = motif.play(tpt, B(31), "A4", "answer", hold=2.75, vel=104, accent=8)
    tpt.vibrato(ev[5][0] + 0.3, ev[5][0] + 2.7, depth=16, rate=5.5)
    ev = motif.play(tpt, B(33), "D5", "rise", hold=2.5, vel=102, accent=8)
    tpt.vibrato(ev[-1][0] + 0.6, ev[-1][0] + 2.4, depth=14, rate=5.5)
    tpt.seq(B(34), "F5:q> E5:e D5:e Ab5:h", vel=104)
    for pos in (0, 3, 6):
        tpt.note(B(35) + pos * 0.5, "G5", 0.5, 110, gate=0.6)
    tpt.note(B(35, 4), "F5", 1.0, 104, gate=0.6)
    horn.chord(B(25), "D3 A3", 8.0, vel=84)
    horn.chord(B(27), "E3 B3", 4.0, vel=88)
    horn.chord(B(28), "E3 G#3", 3.4, vel=92)
    for pos in (0, 3, 6):
        horn.chord(B(35) + pos * 0.5, "E3 D4", 0.5, vel=104, gate=0.6)

    # ================================================================ brass punches
    def punch(bar, positions, chord, vel=98, dur=1.0):
        for pos in positions:
            brass.chord(B(bar) + pos * 0.5, BR[chord], dur * 0.5, vel=vel, gate=0.8, top=4)

    punch(2, [7], "Am", 92)
    punch(3, [7], "Am", 96)
    punch(4, [0, 3], "E7#9", 104)
    brass.chord(B(4, 3), BR["E7#9"], 1.9, vel=96)
    brass.cc(B(4, 2.95), 11, 70)
    brass.ramp(11, B(4, 3), B(4, 4.8), 70, 127, step=0.125, curve=1.3)
    punch(6, [2, 3], "Am(maj9)", 96)
    punch(8, [3, 5], "E7", 98)
    punch(10, [5, 7], "Dm6", 96)
    punch(11, [4], "Bb7#11", 100, dur=2)
    punch(12, [3, 5, 7], "E7#9", 102)
    # B: anticipations on the "and" of 4, answering the guitar
    for bar, chord in ((13, "Fmaj7#11"), (15, "G7sus"), (17, "Cmaj7"), (19, "Dm9")):
        punch(bar, [7], chord, 92)
    punch(20, [0, 3, 6], "E7(13)", 104)          # the guitar bends #9 -> 3 itself
    punch(26, [3, 5, 7], "Dm9", 98)
    brass.chord(B(27), BR["E7"], 3.8, vel=92, gate=1.0)
    brass.cc(B(26, 4.9), 11, 64)
    brass.ramp(11, B(27), B(28, 1), 64, 127, step=0.125, curve=1.4)
    punch(28, [0, 1, 2], "E7(13)", 108)
    punch(30, [2, 3], "Am(maj9)", 102)
    punch(32, [3, 5], "E7", 104)
    punch(33, [7], "Dm(maj9)", 100)
    punch(34, [4], "Bb7#11", 106, dur=2)
    for pos in (0, 3, 6):
        punch(35, [pos], "E7#9", 112)
    brass.chord(B(35, 4), "G#3 D4 G4 B4", 0.5, vel=108, gate=0.6)

    # ================================================================ rhythm guitar
    # (out while the theme is stated: its semitone slips would rub against the chugs)
    for bar in (1, 2, 3, 4, 12, 25, 26, 27, 28):
        chord = CHORDS[bar]
        v = CHUG.get(chord)
        if not v:
            continue
        soft = bar <= 2
        for i in range(6 if bar in (4, 28) else 8):
            acc = 10 if i in (0, 3, 6) else 0
            rhy.chord(B(bar) + i * 0.5, v, 0.5, vel=(70 if soft else 84) + acc, gate=0.5,
                      strum=0.006, down=(i % 2 == 0))

    # ================================================================ organ (B section)
    for bar, v in ORGAN.items():
        organ.chord(B(bar), v, 4.0, vel=78)
    organ.cc(B(12, 4.5), 11, 90)
    organ.ramp(11, B(13), B(14), 90, 120, step=0.25)
    organ.ramp(11, B(19), B(20, 4.5), 120, 127, step=0.25)

    # ================================================================ drums
    GA = {"kick": "x.....x.x.......", "snare": "....x..,....x..,"}
    GB = {"kick": "x.....x.x.....x.", "snare": "....x..,....x.,,"}
    GW = {"kick": "x.......x.x.....", "snare": "....x.......x..,"}      # B: lighter
    TOMS = {"kick": "x.........x.....", "tom_f2": "x.o.x.o.x.o.x.o.", "stick": "....x.......x..."}
    fills = {
        4: {"kick": "x.....x.x.......", "snare": "....x.....x.xxxx"},
        12: {"kick": "x.....x.........", "snare": "....x...x.x.....", "tom_h": "...........xx...",
             "tom_l": ".............xx.", "tom_f2": "...............x"},
        20: {"kick": "x.....x...x.....", "snare": "....x.......x.xx", "tom_l": "..............x."},
        24: {"kick": "x.........x.....", "tom_f2": "x.o.x.o.x.......", "snare": "........o.o.xxxX"},
    }
    for bar in range(1, 35):
        b = B(bar)
        if bar in fills:
            kit.drums(b, fills[bar])
        elif bar <= 12 or bar >= 29:
            kit.drums(b, GA if bar % 2 else GB, vel_scale=0.9 if bar <= 2 else 1.0)
        elif bar <= 20:
            kit.drums(b, GW, vel_scale=0.95)
        elif bar <= 23:
            kit.drums(b, TOMS, vel_scale=0.74 + 0.04 * (bar - 21))
        else:  # 25-28: snare build
            kit.hits(b, "x.......x.......", "kick")
            if bar <= 26:
                kit.hits(b, "....x.......x...", "snare")
                kit.hits(b, "..o...o...o...o.", "tom_f2", vel_scale=0.8)
            elif bar == 27:
                kit.hits(b, "o.o.o.o.x.x.x.x.", "snare")
            else:
                kit.hits(b, "ooooxxxxxxxxXXXX", "snare")
                kit.hits(b, "x...x...x...x...", "kick")
    # turnaround: stop-time, then the fill home
    kit.hits(B(35), "X.....X.....X...", "kick")
    kit.hits(B(35), "X.....X.....X...", "snare")
    kit.hits(B(35), "........x.......", "kick", vel_scale=0.9)
    kit.hits(B(36), "x.......x.x.....", "kick")
    kit.hits(B(36), "....x.xxx.x.....", "snare")
    kit.hits(B(36), "............xx..", "tom_h")
    kit.hits(B(36), "..............x.", "tom_l")
    kit.hits(B(36), "...............X", "tom_f2")

    # hats / ride
    for bar in range(1, 35):
        b = B(bar)
        if bar <= 12 or bar >= 29:
            hats.hits(b, "x.o.x.o.x.o.x.o.", "hat", vel_scale=0.85 if bar <= 4 else 0.95)
            if bar % 2 == 0 and bar not in (4, 12):
                hats.hits(b + 3.5, "o", "ohat")
        elif bar <= 20:
            hats.hits(b, "x.o.x-o.x.o.x-o.", "ride", vel_scale=0.9)
            hats.hits(b, "....x.......x...", "pedal", vel_scale=0.8)
        elif bar <= 24:
            hats.hits(b, "o...o...o...o...", "pedal", vel_scale=0.9)
        else:
            hats.hits(b, "x-o-x-o-x-o-x-o-", "hat", vel_scale=0.6 + 0.08 * (bar - 25))
    hats.hits(B(36), "x.o.x.o.", "hat", vel_scale=0.8)

    # tambourine: the surf engine
    for bar in range(1, 35):
        b = B(bar)
        if bar <= 4:
            tamb.hits(b, ",.-.,.-.,.-.,.-.", "tamb", vel_scale=0.8 + 0.05 * bar)
        elif bar <= 12 or bar >= 29:
            tamb.hits(b, "-,o,x,o,-,o,x,o,", "tamb")
        elif bar <= 20:
            tamb.hits(b, "....x.......x...", "tamb")
        elif bar <= 24:
            tamb.hits(b, "..o...o...o...o.", "tamb", vel_scale=0.9)
        else:
            tamb.hits(b, "-,o,-,o,-,o,-,o,", "tamb", vel_scale=0.8 + 0.06 * (bar - 25))
    tamb.hits(B(36), "x.o.x.o.", "tamb")

    # crashes and accents
    for bar, v in ((1, 100), (5, 108), (13, 100), (21, 104), (29, 116), (33, 100)):
        cym.note(B(bar), 49, 2.0, v)
    cym.note(B(9), 57, 2.0, 92)
    cym.note(B(25), 57, 2.0, 96)
    cym.note(B(11), 55, 1.0, 92)                       # splash on the Bb7
    cym.note(B(34), 52, 2.0, 100)                      # china on the Bb7 in A'
    for pos in (0, 3, 6):
        cym.note(B(35) + pos * 0.5, 57 if pos else 49, 1.0, 108)
    cym.note(B(36, 4.5), 55, 0.5, 92)
    return s
