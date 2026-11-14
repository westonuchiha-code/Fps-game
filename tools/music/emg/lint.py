"""Score sanity checks -- the "ears" of a pipeline nobody can listen to.

lint(song) inspects the note data (not the audio) and reports:

  range      notes outside the instrument's sensible written range
  clash      sustained minor 2nds / minor 9ths between any two pitched voices
  static     more than 8 consecutive bars with an unchanged texture
  ctl        controllers / pitch bend that do not return to rest by the loop end
  theme      where the Clearance theme (motif.SIGNATURES) occurs in each part
  forbidden  the two riffs the brief bans outright, by interval pattern:
             the chromatic 5-b6-6-b6 inner-voice vamp and the
             "dum di-di dum dum" repeated-note surf riff
"""
from __future__ import annotations

from collections import defaultdict

from .seq import Song
from .theory import name


def _lines(part):
    """Melodic lines to scan: top voice, bottom voice (by onset groups)."""
    groups = defaultdict(list)
    for nt in part.notes:
        groups[round(nt.beat * 48)].append(nt)
    keys = sorted(groups)
    top = [(k / 48.0, max(x.pitch for x in groups[k])) for k in keys]
    bot = [(k / 48.0, min(x.pitch for x in groups[k])) for k in keys]
    return {"top": top, "bottom": bot}


def find_pattern(line, steps, max_gap: float | None = None):
    """Start beats where consecutive notes of `line` move by `steps` semitones."""
    hits = []
    k = len(steps)
    for i in range(len(line) - k):
        if all(line[i + j + 1][1] - line[i + j][1] == steps[j] for j in range(k)):
            if max_gap is None or all(line[i + j + 1][0] - line[i + j][0] <= max_gap for j in range(k)):
                hits.append(line[i][0])
    return hits


def lint(song: Song, signatures: dict | None = None, tonic_pc: int | None = None) -> dict:
    out = {"range": [], "clash": [], "static": [], "ctl": [], "theme": [], "forbidden": []}
    bpb = song.bpb

    def where(beat):
        b = beat % song.total_beats if song.loop else beat
        return f"bar {int(b // bpb) + 1} beat {b % bpb + 1:.2f}"

    pitched = [p for p in song.parts if not p.drum and p.notes]

    # ---- range
    for p in pitched:
        lo = min(x.pitch for x in p.notes)
        hi = max(x.pitch for x in p.notes)
        if p.lo is not None and lo < p.lo:
            out["range"].append(f"{p.name}: {name(lo)} below {name(p.lo)}")
        if p.hi is not None and hi > p.hi:
            out["range"].append(f"{p.name}: {name(hi)} above {name(p.hi)}")

    # ---- clashes (minor 2nd / minor 9th held together for >= 0.3 beat)
    evs = []
    for p in pitched:
        if p.role == "fx":
            continue
        for x in p.notes:
            evs.append((x.beat, x.beat + x.dur * min(1.0, p.gate if p.gate else 1.0), x.pitch, p.name))
    evs.sort()
    active = []
    seen = set()
    for st, en, pit, pn in evs:
        active = [a for a in active if a[1] > st + 1e-9]
        for a in active:
            d = abs(a[2] - pit)
            if d in (1, 13):
                ov = min(a[1], en) - st
                if ov >= 0.3:
                    key = (round(st * 4), min(a[2], pit), max(a[2], pit))
                    if key not in seen:
                        seen.add(key)
                        out["clash"].append(
                            f"{where(st)}: {a[3]} {name(a[2])} vs {pn} {name(pit)} ({ov:.2f} beats)")
        active.append((st, en, pit, pn))

    # ---- static texture (> 8 bars with the same parts playing the same pitch classes)
    sig = []
    for b in range(song.bars):
        b0, b1 = b * bpb, (b + 1) * bpb
        parts_on = []
        pcs = set()
        for p in song.parts:
            hit = [x for x in p.notes if b0 <= (x.beat % song.total_beats if song.loop else x.beat) < b1]
            if hit:
                pat = tuple(sorted((round((x.beat - b0) % bpb * 12), x.pitch) for x in hit))
                parts_on.append((p.name, hash(pat) if p.drum else len(hit)))
                if not p.drum:
                    pcs.update(x.pitch % 12 for x in hit)
        sig.append((tuple(sorted(n for n, _ in parts_on)), tuple(sorted(pcs))))
    run = 1
    for i in range(1, len(sig)):
        run = run + 1 if sig[i] == sig[i - 1] else 1
        if run == 9:
            out["static"].append(f"bars {i - 7}..{i + 1}+ share one texture and harmony")

    # ---- controller state at loop end
    if song.loop:
        for p in song.parts:
            last_bend = None
            cc_first = {}
            cc_last = {}
            for c in sorted(p.ctl, key=lambda c: c.t):
                if c.kind == "bend":
                    last_bend = c.a
                else:
                    cc_first.setdefault(c.a, c.b)
                    cc_last[c.a] = c.b
            if last_bend not in (None, 0):
                out["ctl"].append(f"{p.name}: pitch bend ends at {last_bend}, not 0")
            for num, v in cc_last.items():
                rest = 127 if num == 11 else (0 if num in (1, 64) else None)
                if rest is not None and v != rest:
                    out["ctl"].append(f"{p.name}: CC{num} ends at {v} (rest value {rest})")

    # ---- theme occurrences
    if signatures:
        for p in pitched:
            ln = _lines(p)["top"]
            found = []
            for form, steps in signatures.items():
                for b in find_pattern(ln, steps, max_gap=4.5):
                    found.append((b, form))
            if found:
                found.sort()
                txt = ", ".join(f"{form}@bar{int((b % song.total_beats) // bpb) + 1}" for b, form in found[:14])
                more = "" if len(found) <= 14 else f" (+{len(found) - 14} more)"
                out["theme"].append(f"{p.name}: {txt}{more}")

    # ---- forbidden riffs
    vamp_cycle = [1, 1, -1, -1]
    vamps = [vamp_cycle[i:] + vamp_cycle[:i] for i in range(4)]
    surf = [2, 0, 0, 0, -2, 0, 0]
    for p in pitched:
        for lname, ln in _lines(p).items():
            for steps in vamps:
                for b in find_pattern(ln, steps, max_gap=4.5):
                    out["forbidden"].append(f"{p.name} ({lname}) {where(b)}: chromatic up-up-down-down vamp")
            for b in find_pattern(ln, surf, max_gap=1.0):
                out["forbidden"].append(f"{p.name} ({lname}) {where(b)}: repeated-note surf riff shape")
    return out


def report(song: Song, res: dict, verbose: bool = False) -> list[str]:
    lines = []
    for key in ("forbidden", "range", "ctl", "static"):
        for msg in res[key]:
            lines.append(f"  lint[{key}] {msg}")
    n_clash = len(res["clash"])
    if n_clash:
        lines.append(f"  lint[clash] {n_clash} sustained semitone/minor-9th overlaps"
                     + ("" if verbose else " (use --lint to list)"))
        if verbose:
            lines += [f"      {m}" for m in res["clash"]]
    for msg in res["theme"]:
        lines.append(f"  theme: {msg}")
    return lines
