"""The "Clearance theme" -- the score's one leitmotif.

An original five-note cell built from first principles for this game:

    rhythm   tresillo (3+3+2 eighths):   e  q  | e  q  | q~
    pitch    the minor triad, each tone "slipping" down a semitone:
             1 -> 7,   b3 -> 2,   5 (held)
    D minor  D  C# |  F  E  |  A

The accented eighths spell the tonic triad (1, b3, 5); the long notes they
slip onto are the major 7th and the 9th -- together the minor-major-ninth
"spy chord", unfolded as a line instead of strummed.  Dry, a little sly,
never quite standing on the tonic: Clearance in a tuxedo under a hi-vis vest.

Forms used across the score (semitones above the tonic):

    RISE    1 7 | b3 2 | 5            the statement
    ANSWER  b3 2 | 5 #4 | 8 ... 8 7   sequence up the triad, hangs on the 7th
    FALL    5 #4 | b3 2 | 1           mirror image; closes phrases, death sting
    DARK    1 7 | b3 2 | b5           boss: the fifth is flattened, and
    DARK2   b3 2 | b5 4 | 6           ... the slips climb a diminished 7th chord
"""
from __future__ import annotations

from emg.theory import n

# (offset in beats, duration in beats or None = caller's `hold`, semitones from tonic)
RISE = [(0.0, 0.5, 0), (0.5, 1.0, -1), (1.5, 0.5, 3), (2.0, 1.0, 2), (3.0, None, 7)]
ANSWER = [(0.0, 0.5, 3), (0.5, 1.0, 2), (1.5, 0.5, 7), (2.0, 1.0, 6), (3.0, 2.0, 12), (5.0, None, 11)]
FALL = [(0.0, 0.5, 7), (0.5, 1.0, 6), (1.5, 0.5, 3), (2.0, 1.0, 2), (3.0, None, 0)]
DARK = [(0.0, 0.5, 0), (0.5, 1.0, -1), (1.5, 0.5, 3), (2.0, 1.0, 2), (3.0, None, 6)]
DARK2 = [(0.0, 0.5, 3), (0.5, 1.0, 2), (1.5, 0.5, 6), (2.0, 1.0, 5), (3.0, None, 9)]

FORMS = {"rise": RISE, "answer": ANSWER, "fall": FALL, "dark": DARK, "dark2": DARK2}

# semitone step patterns, used by the linter to find the theme in each track
SIGNATURES = {
    "rise": [-1, 4, -1, 5],
    "answer": [-1, 5, -1, 6],
    "fall": [-1, -3, -1, -2],
    "dark": [-1, 4, -1, 4],
}


def play(part, beat: float, tonic, form: str = "rise", hold: float = 2.0,
         stretch: float = 1.0, vel: float | None = None, accent: float = 12.0,
         long_vel: float = 0.0, gate_short: float = 0.9, gate_long: float = 0.98,
         octaves=(0,)) -> list[tuple[float, float, int]]:
    """Write one statement of the theme into `part`.

    stretch  2.0 = augmentation (boss), 0.5 = diminution
    accent   extra velocity on the short, on-the-tresillo notes
    octaves  extra octave doublings, e.g. (0, 12)
    Returns [(start_beat, dur_beats, midi_pitch)] so callers can add vibrato,
    dips and falls to particular notes.
    """
    t = n(tonic)
    base = part.vel if vel is None else vel
    out = []
    for off, dur, semi in FORMS[form]:
        d = (hold if dur is None else dur * stretch)
        short = dur is not None and dur <= 0.5
        v = base + (accent if short else long_vel)
        g = gate_short if short else gate_long
        for o in octaves:
            part.note(beat + off * stretch, t + semi + o, d, v, gate=g)
        out.append((beat + off * stretch, d, t + semi))
    return out
