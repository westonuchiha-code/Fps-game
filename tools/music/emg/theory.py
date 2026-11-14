"""Note-name helpers.  Middle C = C4 = MIDI 60."""
from __future__ import annotations

import re

_NOTE = re.compile(r"^([A-Ga-g])([#b]{0,2})(-?\d)$")
_BASE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]


def n(name) -> int:
    """'C#4' / 'Eb3' / 61 -> MIDI note number."""
    if isinstance(name, (int, float)):
        return int(name)
    m = _NOTE.match(name.strip())
    if not m:
        raise ValueError(f"bad note name: {name!r}")
    letter, acc, octv = m.groups()
    val = 12 * (int(octv) + 1) + _BASE[letter.upper()]
    val += acc.count("#") - acc.count("b")
    return val


def nn(names) -> list[int]:
    """'C3 E3 G3' or ['C3', 'E3'] -> list of MIDI numbers."""
    if isinstance(names, str):
        names = names.replace("+", " ").split()
    return [n(x) for x in names]


def name(midi: int, flats: bool = False) -> str:
    tbl = _FLAT_NAMES if flats else _SHARP_NAMES
    return f"{tbl[midi % 12]}{midi // 12 - 1}"


def hz(midi: float) -> float:
    return 440.0 * 2.0 ** ((midi - 69) / 12.0)
