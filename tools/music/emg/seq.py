"""A tiny score model: Song -> Parts -> notes / controllers / pitch bends.

Positions are written in beats (quarter notes, 0-based float).  Each Part is
exported to its own Standard MIDI File whose clock is 1 tick == 1 audio sample
(PPQ 22050 at 120 BPM), so every event can be placed sample-accurately and the
loop repetition offset is *exactly* the loop length in samples.

Loop songs: every event time is wrapped modulo the loop length, and the part is
written out `reps` times back to back.  Pickups written "before bar 1" and
notes that ring across the loop point therefore work without special cases.
"""
from __future__ import annotations

import math
import random
import re
import zlib
from dataclasses import dataclass, field

import mido

from . import SR
from .theory import n as note_num

PPQ = 22050          # ticks per quarter at tempo 500000us -> 44100 ticks / second
TEMPO_US = 500000
BLOCK = 64           # FluidSynth renders (and applies MIDI events) in 64-sample blocks
ONE_SHOT_LEAD = 0.25 * SR   # room before beat 0 of a one-shot for early (negative-lay) notes
_DT_MS = TEMPO_US / PPQ / 1000.0


def _player_ticks(block: int) -> int:
    """MIDI tick FluidSynth's file player has reached when audio block `block`
    is about to be rendered.  Its clock is whole milliseconds:
    msec = (long)(1000 * 64 * block / sample_rate); ticks = (int)(msec / dt + .5)."""
    msec = (64000 * block) // SR
    return int(msec / _DT_MS + 0.5)


def tick_for_block(block: int) -> int:
    """MIDI tick that makes an event take effect exactly at sample 64 * block.

    FluidSynth applies an event one block after the first block whose player
    tick has reached it, so the event must fall in the tick interval that
    belongs to block-1.  We aim 20 ticks inside that interval (50 when the
    millisecond clock lands exactly on an integer, where float rounding could
    go either way).  Verified empirically in tools/music/verify.py --synth.
    """
    c = _player_ticks(block - 1)
    exact_ms = (64000 * (block - 1)) % SR == 0
    return max(0, c - (50 if exact_ms else 20))

# symbolic durations, in beats
DUR = {
    "w": 4.0, "dh": 3.0, "h": 2.0, "dq": 1.5, "q": 1.0, "de": 0.75, "e": 0.5,
    "ds": 0.375, "s": 0.25, "x": 0.125,
    "ht": 4 / 3, "qt": 2 / 3, "t": 1 / 3, "st": 1 / 6,
}

# General MIDI percussion map (channel 10)
GM_DRUMS = {
    "kick": 36, "kick2": 35, "stick": 37, "snare": 38, "clap": 39, "snare2": 40,
    "tom_f2": 41, "hat": 42, "tom_f1": 43, "pedal": 44, "tom_l": 45, "ohat": 46,
    "tom_lm": 47, "tom_hm": 48, "crash": 49, "tom_h": 50, "ride": 51, "china": 52,
    "bell": 53, "tamb": 54, "splash": 55, "cowbell": 56, "crash2": 57,
    "vibraslap": 58, "ride2": 59, "bongo_h": 60, "bongo_l": 61, "conga_m": 62,
    "conga_h": 63, "conga_l": 64, "timb_h": 65, "timb_l": 66, "agogo_h": 67,
    "agogo_l": 68, "cabasa": 69, "maracas": 70, "guiro_s": 73, "guiro_l": 74,
    "claves": 75, "wood_h": 76, "wood_l": 77, "cuica_m": 78, "cuica_o": 79,
    "tri_m": 80, "tri_o": 81, "shaker": 82, "jingle": 83, "belltree": 84,
    "castanets": 85, "surdo_m": 86, "surdo_o": 87,
    # GS extras below the GM range (present in FluidR3 kits)
    "sticks": 31, "sqclick": 32, "metro": 33, "metrobell": 34,
}

# step-pattern velocity letters
STEP_VEL = {"X": 120, "x": 104, "o": 88, "-": 72, "g": 54, ",": 42}

_TOKEN = re.compile(
    r"^(?P<p>[^:@>^<?'_]+)"
    r"(?::(?P<d>[a-z]+|[0-9.]+(?:/[0-9.]+)?))?"
    r"(?P<f>[>^<?'_]*)"
    r"(?:@(?P<v>\d+))?$"
)


def _dur(tok: str) -> float:
    if tok in DUR:
        return DUR[tok]
    if "/" in tok:
        a, b = tok.split("/")
        return float(a) / float(b)
    return float(tok)


@dataclass
class Note:
    beat: float      # nominal (written) start, beats
    dur: float       # nominal (written) duration, beats
    pitch: int
    vel: int
    t0: float        # performed start, seconds
    t1: float        # performed end, seconds


@dataclass
class Ctl:
    t: float         # seconds
    kind: str        # 'cc' | 'bend'
    a: int           # cc number (cc) / bend value -8192..8191 (bend)
    b: int = 0       # cc value


class Song:
    def __init__(self, name: str, bpm: float, bars: int, beats_per_bar: int = 4,
                 loop: bool = True, swing: tuple[float, float] | None = None,
                 tempo_map: list[tuple[float, float]] | None = None,
                 key: str = "", seed: int | None = None):
        self.name = name
        self.bpm = float(bpm)
        self.bars = int(bars)
        self.bpb = int(beats_per_bar)
        self.loop = loop
        self.swing = swing            # (unit in beats, ratio 0.5..0.75)
        self.key = key
        self.parts: list[Part] = []
        self.seed = zlib.crc32(name.encode()) if seed is None else seed
        self.sections: list[tuple[int, str]] = []   # (bar, label) for reports
        self.chords: dict[int, str] = {}            # bar -> chord symbol (for lint/report)
        self.passes: int | None = None              # loop render passes (None = mix.LOOP_PASSES)
        self._tm = None
        if tempo_map:
            self._build_tempo_map(tempo_map)

    # ---- time ---------------------------------------------------------
    @property
    def total_beats(self) -> float:
        return self.bars * self.bpb

    @property
    def loop_samples(self) -> int:
        """Loop length in samples = round(bars * beatsPerBar * 60 / bpm * SR)."""
        return int(round(self.bars * self.bpb * 60.0 / self.bpm * SR))

    def bar(self, bar: int, beat: float = 1.0) -> float:
        """(1-based bar, 1-based beat) -> absolute beats."""
        return (bar - 1) * self.bpb + (beat - 1.0)

    def _build_tempo_map(self, pts):
        # piecewise-linear bpm over beats, integrated numerically on a fine grid
        step = 1 / 96
        nmax = int(math.ceil((self.total_beats + 16) / step)) + 1
        times = [0.0]
        pts = sorted(pts)

        def bpm_at(b):
            if b <= pts[0][0]:
                return pts[0][1]
            for (b0, v0), (b1, v1) in zip(pts, pts[1:]):
                if b0 <= b <= b1:
                    return v0 + (v1 - v0) * (b - b0) / max(1e-9, b1 - b0)
            return pts[-1][1]

        for i in range(1, nmax):
            b_mid = (i - 0.5) * step
            times.append(times[-1] + step * 60.0 / bpm_at(b_mid))
        self._tm = (step, times)

    def sec(self, beat: float) -> float:
        """Beat position -> seconds (no swing)."""
        if self._tm is None:
            return beat * 60.0 / self.bpm
        step, times = self._tm
        if beat < 0:
            return beat * 60.0 / self.bpm
        x = beat / step
        i = min(int(x), len(times) - 2)
        f = x - i
        return times[i] * (1 - f) + times[i + 1] * f

    def swung(self, beat: float) -> float:
        """Apply the song's swing grid to a beat position."""
        if not self.swing:
            return beat
        unit, ratio = self.swing
        pair = 2 * unit
        base = math.floor(beat / pair) * pair
        x = (beat - base) / pair            # 0..1 within the pair
        if x < 0.5:
            y = x * 2 * ratio
        else:
            y = ratio + (x - 0.5) * 2 * (1 - ratio)
        return base + y * pair

    # ---- structure ----------------------------------------------------
    def part(self, name: str, program: int = 0, **kw) -> "Part":
        p = Part(self, name, program, **kw)
        self.parts.append(p)
        return p

    def section(self, bar: int, label: str):
        self.sections.append((bar, label))

    def harmony(self, **bars_to_chords):
        """song.harmony(b1='Dm6/9', b3='Gm9') -- labels only (reports / lint)."""
        for k, v in bars_to_chords.items():
            self.chords[int(k.lstrip("b"))] = v


class Part:
    """One instrument.  Rendered to its own audio stem and auto-balanced."""

    def __init__(self, song: Song, name: str, program: int = 0, *, bank: int = 0,
                 drum: bool = False, vel: int = 96, gate: float = 0.92,
                 human_ms: float = 6.0, human_vel: float = 5.0, lay_ms: float = 0.0,
                 pan: float = 0.0, rev: int = 40, cho: int = 0, vol: int = 110,
                 bend_range: int = 2, swing: bool = True,
                 # mix attributes (see mix.py)
                 level: float = -6.0, stem: str = "main", hp: float | None = None,
                 lp: float | None = None, width: float | None = None,
                 space: str = "hall", clip_db: float | None = None,
                 lo: str | None = None, hi: str | None = None,
                 role: str = "harmony", gain: float = 0.0):
        self.song = song
        self.name = name
        self.program = program
        self.bank = bank
        self.drum = drum
        self.channel = 9 if drum else 0
        self.vel = vel
        self.gate = gate
        self.human_ms = human_ms
        self.human_vel = human_vel
        self.lay_ms = lay_ms
        self.pan = pan
        self.rev = rev
        self.cho = cho
        self.vol = vol
        self.bend_range = bend_range
        self.use_swing = swing
        self.level = level
        self.stem = stem
        self.hp = hp
        self.lp = lp
        self.width = width
        self.space = space                          # reverb bus: hall | room | plate
        self.clip_db = clip_db
        self.gain = gain                            # manual trim after auto-balance, dB
        self.lo = note_num(lo) if lo else None      # sensible written range (lint)
        self.hi = note_num(hi) if hi else None
        self.role = role                            # bass | harmony | lead | perc | fx
        self.notes: list[Note] = []
        self.ctl: list[Ctl] = []
        self.rng = random.Random(zlib.crc32(f"{song.name}:{name}".encode()) ^ song.seed)

    # ---- helpers ------------------------------------------------------
    def _t(self, beat: float) -> float:
        b = self.song.swung(beat) if self.use_swing else beat
        return self.song.sec(b)

    def _jit(self) -> float:
        if self.human_ms <= 0:
            return 0.0
        s = self.human_ms / 1000.0
        return max(-2.2 * s, min(2.2 * s, self.rng.gauss(0.0, s)))

    def _vel(self, v: float) -> int:
        if self.human_vel > 0:
            v += self.rng.gauss(0.0, self.human_vel)
        return int(max(1, min(127, round(v))))

    # ---- notes --------------------------------------------------------
    def note(self, beat: float, pitch, dur: float, vel: float | None = None,
             gate: float | None = None, jit: float | None = None) -> None:
        """Add one note.  `dur` in beats; sounding length = dur * gate."""
        p = note_num(pitch)
        g = self.gate if gate is None else gate
        v = self.vel if vel is None else vel
        j = self._jit() if jit is None else jit
        t0 = self._t(beat) + self.lay_ms / 1000.0 + j
        t1 = self._t(beat + dur * g) + self.lay_ms / 1000.0 + j
        if t1 - t0 < 0.03:
            t1 = t0 + 0.03
        self.notes.append(Note(beat, dur, p, self._vel(v), t0, t1))

    def chord(self, beat: float, pitches, dur: float, vel: float | None = None,
              gate: float | None = None, strum: float = 0.0, down: bool = False,
              top: float = 0.0) -> None:
        """Add a chord.  strum = seconds between successive strings/keys.
        `top` adds velocity to the highest voice (melodic voicing)."""
        if isinstance(pitches, str):
            pitches = pitches.replace("+", " ").split()
        ps = sorted(note_num(p) for p in pitches)
        order = list(reversed(ps)) if down else ps
        j = self._jit()
        v = self.vel if vel is None else vel
        for i, p in enumerate(order):
            vv = v + (top if p == ps[-1] else 0.0)
            spread = self.rng.gauss(0.0, 0.0015) if self.human_ms > 0 else 0.0
            self.note(beat, p, dur, vv, gate, jit=j + i * strum + spread)

    def seq(self, beat: float, text: str, vel: float | None = None,
            gate: float | None = None, tr: int = 0) -> float:
        """Sequence of `pitch[:dur][flags][@vel]` tokens; returns the end beat.

        pitch   note name, chord 'C3+E3+G3', or 'r' (rest)
        dur     beats (0.5, 3/4) or symbol (w dh h dq q de e ds s x ht qt t st);
                omitted -> same as previous token
        flags   > accent  ^ strong accent  < soft  ? ghost  ' staccato  _ legato
        """
        base_v = self.vel if vel is None else vel
        base_g = self.gate if gate is None else gate
        d = 1.0
        pos = beat
        for tok in text.split():
            if tok == "|":
                continue
            m = _TOKEN.match(tok)
            if not m:
                raise ValueError(f"{self.name}: bad token {tok!r}")
            if m.group("d"):
                d = _dur(m.group("d"))
            flags = m.group("f") or ""
            p = m.group("p")
            if p != "r":
                v = float(m.group("v")) if m.group("v") else base_v
                v += 14 * flags.count(">") + 26 * flags.count("^")
                v -= 14 * flags.count("<") + 32 * flags.count("?")
                g = base_g
                if "'" in flags:
                    g = min(g, 0.45)
                if "_" in flags:
                    g = 1.0 + 0.04 / max(d, 0.05)
                if "+" in p:
                    self.chord(pos, [note_num(x) + tr for x in p.split("+")], d, v, g)
                else:
                    self.note(pos, note_num(p) + tr, d, v, g)
            pos += d
        return pos

    def cells(self, beat: float, cells, step: float = 0.25, vel: float | None = None,
              gate: float | None = None, tr: int = 0) -> None:
        """Grid riff: cells = [(position, pitch, length[, velocity delta]), ...]
        with position/length counted in `step` beats (default sixteenths)."""
        base = self.vel if vel is None else vel
        for c in cells:
            pos, pitch, ln = c[0], c[1], c[2]
            dv = c[3] if len(c) > 3 else 0
            self.note(beat + pos * step, note_num(pitch) + tr, ln * step, base + dv, gate)

    def hits(self, beat: float, pattern: str, pitch, step: float = 0.25,
             dur: float | None = None, vel_scale: float = 1.0,
             vel_add: float = 0.0, gate: float | None = None) -> float:
        """Step pattern on one pitch: X x o - g , = loud..ghost, '.' = rest."""
        pattern = pattern.replace(" ", "").replace("|", "")
        p = GM_DRUMS[pitch] if (self.drum and isinstance(pitch, str) and pitch in GM_DRUMS) \
            else note_num(pitch)
        for i, ch in enumerate(pattern):
            if ch == ".":
                continue
            v = STEP_VEL[ch] * vel_scale + vel_add
            self.note(beat + i * step, p, step if dur is None else dur, v, gate)
        return beat + len(pattern) * step

    def drums(self, beat: float, lines: dict[str, str], step: float = 0.25,
              vel_scale: float = 1.0, bars: int = 1) -> float:
        """Several step patterns at once: {'kick': 'x...x...', 'snare': ...}."""
        end = beat
        for rep in range(bars):
            for inst, pat in lines.items():
                pat = pat.replace(" ", "").replace("|", "")
                e = self.hits(beat + rep * len(pat) * step, pat, inst, step,
                              dur=min(step, 0.25), vel_scale=vel_scale, gate=1.0)
            end = e
        return end

    # ---- controllers --------------------------------------------------
    def cc(self, beat: float, num: int, val: float) -> None:
        self.ctl.append(Ctl(self._t(beat) + self.lay_ms / 1000.0, "cc", num,
                            int(max(0, min(127, round(val))))))

    def ramp(self, num: int, b0: float, b1: float, v0: float, v1: float,
             step: float = 0.125, curve: float = 1.0) -> None:
        """Controller ramp v0 -> v1 between beats b0..b1 (curve>1 = late rise)."""
        steps = max(1, int(round((b1 - b0) / step)))
        last = None
        for i in range(steps + 1):
            x = i / steps
            v = int(round(v0 + (v1 - v0) * (x ** curve)))
            if v != last:
                self.cc(b0 + (b1 - b0) * x, num, v)
                last = v

    def _bend_val(self, cents: float) -> int:
        v = int(round(cents / (self.bend_range * 100.0) * 8191))
        return max(-8192, min(8191, v))

    def bend(self, beat: float, cents: float) -> None:
        self.ctl.append(Ctl(self._t(beat) + self.lay_ms / 1000.0, "bend",
                            self._bend_val(cents)))

    def bend_at(self, sec: float, cents: float) -> None:
        self.ctl.append(Ctl(sec, "bend", self._bend_val(cents)))

    def glide(self, b0: float, b1: float, c0: float, c1: float,
              curve: float = 1.0, after: float | None = None) -> None:
        """Pitch-bend line from c0 to c1 cents between beats b0..b1.
        If `after` is given the bend snaps to that value just after b1."""
        t0 = self._t(b0) + self.lay_ms / 1000.0
        t1 = self._t(b1) + self.lay_ms / 1000.0
        steps = max(2, int((t1 - t0) / 0.006))
        for i in range(steps + 1):
            x = i / steps
            self.bend_at(t0 + (t1 - t0) * x, c0 + (c1 - c0) * (x ** curve))
        if after is not None:
            self.bend_at(t1 + 0.004, after)

    def vibrato(self, b0: float, b1: float, depth: float = 22.0, rate: float = 5.6,
                delay: float = 0.12, attack: float = 0.25, center: float = 0.0,
                release: float = 0.05) -> None:
        """Pitch-bend vibrato (cents) from beat b0 to b1; returns to `center`.
        delay/attack/release are in seconds, rate in Hz."""
        t0 = self._t(b0) + self.lay_ms / 1000.0 + delay
        t1 = self._t(b1) + self.lay_ms / 1000.0
        if t1 - t0 < 0.08:
            return
        dt = 0.007
        steps = int((t1 - t0) / dt)
        ph = self.rng.uniform(0, 0.4)
        for i in range(steps + 1):
            t = i * dt
            env = min(1.0, t / max(1e-3, attack)) * min(1.0, (t1 - t0 - t) / max(1e-3, release))
            c = center + depth * env * math.sin(2 * math.pi * rate * t + ph)
            self.bend_at(t0 + t, c)
        self.bend_at(t1 + 0.002, center)

    # ---- export -------------------------------------------------------
    def events_abs(self, reps: int, pre_blocks: int, loop_nominal: int | None,
                   loop_blocks: int | None):
        """Events on FluidSynth's 64-sample block grid.

        Returns a list of (block, order, mido.Message).  For loops, times are
        wrapped modulo the nominal loop length, scaled onto the rendered loop
        length (`loop_blocks` * 64 samples, within +-32 samples of nominal) and
        repeated `reps` times, so every repetition is scheduled identically.
        """
        ch = self.channel
        notes = []
        ctl = []

        def to_block(t_sec: float) -> int:
            a = t_sec * SR
            if loop_nominal:
                a = (a % loop_nominal) * (loop_blocks * BLOCK / loop_nominal)
            else:
                a = max(0.0, a + ONE_SHOT_LEAD)
            return int(round(a / BLOCK))

        for k in range(reps):
            off = pre_blocks + (k * loop_blocks if loop_nominal else 0)
            for nt in self.notes:
                b0 = to_block(nt.t0)
                ln = max(1, int(round((nt.t1 - nt.t0) * SR / BLOCK)))
                notes.append([off + b0, off + b0 + ln, nt.pitch, nt.vel])
            for c in self.ctl:
                ctl.append((off + to_block(c.t), c))
        # same-pitch overlap: end the earlier note no later than the next attack
        by_pitch: dict[int, list] = {}
        for ev in notes:
            by_pitch.setdefault(ev[2], []).append(ev)
        for lst in by_pitch.values():
            lst.sort(key=lambda e: e[0])
            for a, b in zip(lst, lst[1:]):
                if a[1] > b[0]:
                    a[1] = max(a[0] + 1, b[0])
        out = []
        for on, off_, p, v in notes:
            out.append((on, 2, mido.Message("note_on", channel=ch, note=p, velocity=v)))
            out.append((off_, 1, mido.Message("note_off", channel=ch, note=p, velocity=0)))
        for blk, c in ctl:
            if c.kind == "cc":
                out.append((blk, 0, mido.Message("control_change", channel=ch,
                                                 control=c.a, value=c.b)))
            else:
                out.append((blk, 0, mido.Message("pitchwheel", channel=ch, pitch=c.a)))
        return out

    def write_midi(self, path: str, reps: int, pre_blocks: int,
                   loop_nominal: int | None, loop_blocks: int | None,
                   total_blocks: int) -> None:
        """Write this part as an SMF whose events land on exact 64-sample blocks."""
        ch = self.channel
        mf = mido.MidiFile(type=1, ticks_per_beat=PPQ)
        tr = mido.MidiTrack()
        mf.tracks.append(tr)
        init = [mido.MetaMessage("set_tempo", tempo=TEMPO_US, time=0)]
        if not self.drum:
            init.append(mido.Message("control_change", channel=ch, control=0, value=self.bank))
            init.append(mido.Message("control_change", channel=ch, control=32, value=0))
        init.append(mido.Message("program_change", channel=ch, program=self.program))
        pan = int(max(0, min(127, round(64 + self.pan * 63))))
        for cnum, val in ((7, self.vol), (10, pan), (11, 127), (91, self.rev),
                          (93, self.cho), (1, 0), (64, 0),
                          (101, 0), (100, 0), (6, self.bend_range), (38, 0),
                          (101, 127), (100, 127)):
            init.append(mido.Message("control_change", channel=ch, control=cnum, value=int(val)))
        init.append(mido.Message("pitchwheel", channel=ch, pitch=0))
        for m in init:
            tr.append(m)
        evs = self.events_abs(reps, pre_blocks, loop_nominal, loop_blocks)
        evs.append((total_blocks, 3, mido.Message("control_change", channel=ch,
                                                  control=110, value=0)))
        evs.sort(key=lambda e: (e[0], e[1]))
        last = 0
        for blk, _, msg in evs:
            tick = max(tick_for_block(blk), last)
            tr.append(msg.copy(time=tick - last))
            last = tick
        tr.append(mido.MetaMessage("end_of_track", time=0))
        mf.save(path)
