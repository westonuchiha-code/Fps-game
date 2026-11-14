#!/usr/bin/env python3
"""Render every spoken line in src/data/dialogue.json to public/audio/vo/<id>.ogg.

    python3 tools/voice/gen_voice.py                 # everything
    python3 tools/voice/gen_voice.py --only m01_     # ids starting with m01_
    python3 tools/voice/gen_voice.py --only rivet_see_2
    python3 tools/voice/gen_voice.py --list          # show ids / speakers / what will be said

Pipeline per line (all settings live in vo_cast.py):

    text/say -> clean-up, split at "..."            vo_text.py
             -> offline speech engine (cached)      vo_synth.py
             -> trim, join chunks with real pauses  -> <tmp>/dry/<id>.wav
             -> corrective tone EQ + character FX   vo_fx.py
             -> trim to 30 ms, fades, -16 LUFS, true-peak limit   vo_dsp.py
             -> OGG Vorbis (mono, 44.1 kHz, q4), re-measured after decoding
             -> src/data/vo-manifest.json

Output is deterministic: engines, effects (seeded per line id) and the
encoder (bit-exact flags) all reproduce the same bytes on the same toolchain.
Intermediate files go to $EMG_VO_TMP or <system temp>/emg-vo, never the repo.

Needs: pico2wave, flite, RHVoice-test, espeak-ng, ffmpeg (libvorbis),
python3 with numpy, scipy, soundfile. Companion tools in this folder:
verify.py (acceptance checks), intel_check.py (dry vs. processed
intelligibility), pron_check.py (pronunciation regression), calibrate_eq.py.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

import vo_cast as C  # noqa: E402
import vo_dsp as D  # noqa: E402
import vo_fx as F  # noqa: E402
import vo_synth as S  # noqa: E402
import vo_text as T  # noqa: E402
from vo_measure import SR, loudness, true_peak_db  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))
DIALOGUE = os.path.join(REPO, "src", "data", "dialogue.json")
OUT_DIR = os.path.join(REPO, "public", "audio", "vo")
MANIFEST = os.path.join(REPO, "src", "data", "vo-manifest.json")

TARGET_LUFS = -16.0
PEAK_LIMIT_DB = -1.5      # true-peak ceiling the decoded OGG must respect
CEILING_DB = -2.2         # limiter ceiling before encoding (Vorbis overshoots a little)
EDGE_PAD_MS = 30.0
EDGE_FLOOR_DB = -60.0     # dBFS: below this the clip counts as silent
VORBIS_Q = "4"


def default_tmp() -> str:
    return os.environ.get("EMG_VO_TMP") or os.path.join(tempfile.gettempdir(), "emg-vo")


# ----------------------------------------------------------------------------
# dialogue.json -> entries
# ----------------------------------------------------------------------------


def load_entries(path: str = DIALOGUE) -> list[dict]:
    """Flatten lines[] and barks{} into [{id, who, text, say, kind, group}]."""
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    speakers = data.get("speakers", {})
    out, seen = [], set()

    def add(e):
        if e["id"] in seen:
            raise SystemExit(f"dialogue.json: duplicate id {e['id']!r}")
        if e["who"] not in C.CAST:
            raise SystemExit(f"dialogue.json: {e['id']}: speaker {e['who']!r} has no entry in vo_cast.CAST")
        if e["who"] not in speakers:
            print(f"warning: {e['id']}: speaker {e['who']!r} is not declared under 'speakers'", file=sys.stderr)
        seen.add(e["id"])
        out.append(e)

    for line in data.get("lines", []):
        add({"id": line["id"], "who": line["who"], "text": line["text"], "say": line.get("say") or line["text"],
             "kind": "line", "group": None})
    for set_name, bark_set in data.get("barks", {}).items():
        for voice in bark_set["voices"]:
            for group, texts in bark_set["groups"].items():
                for n, item in enumerate(texts, 1):
                    # a bark may be a plain string or {text, say}
                    text = item["text"] if isinstance(item, dict) else item
                    say = (item.get("say") if isinstance(item, dict) else None) or text
                    add({"id": f"{voice}_{group}_{n}", "who": voice, "text": text, "say": say,
                         "kind": "bark", "group": group})
    return out


# ----------------------------------------------------------------------------
# synthesis
# ----------------------------------------------------------------------------


def _espeak_pitch(base: float, mul: float) -> float:
    """eSpeak -p value that scales F0 by `mul` (measured: +65 per octave up, -75 per octave down)."""
    if abs(mul - 1.0) < 1e-6:
        return base
    return float(np.clip(base + (65.0 if mul > 1.0 else 75.0) * np.log2(mul), 0.0, 99.0))


def effective_spec(spec: dict, delivery: dict) -> dict:
    """Apply a delivery (rate / pitch multipliers) to an engine spec."""
    s = dict(spec)
    rate, pitch = delivery.get("rate", 1.0), delivery.get("pitch", 1.0)
    eng = s["engine"]
    if eng == "pico":
        s["speed"] = s.get("speed", 100) * rate
        s["pitch"] = s.get("pitch", 100) * pitch
    elif eng == "rhvoice":
        s["rate"] = s.get("rate", 100) * rate
        s["pitch"] = s.get("pitch", 100) * pitch
    elif eng == "flite":
        s["stretch"] = s.get("stretch", 1.0) / rate  # no pitch control
    elif eng == "espeak":
        s["speed"] = s.get("speed", 175) * rate
        s["pitch"] = _espeak_pitch(s.get("pitch", 50), pitch)
    return s


def synth_dry(entry: dict, tmp: str, espeak_path: str | None):
    """Return (dry voice, sub-octave layer or None, chunk texts, notes) at 44.1 kHz."""
    cast = C.CAST[entry["who"]]
    delivery = C.delivery_for(entry["who"], entry["kind"], entry["group"])
    spec = effective_spec(cast["synth"], delivery)
    if spec["engine"] == "espeak":
        spec["_espeak_path"] = espeak_path
        spec["_variant_body"] = C.ESPEAK_VARIANTS.get(spec.get("variant", ""), "")
    sub_spec = None
    if cast.get("sub"):
        sub_spec = dict(spec)
        sub_spec.update(cast["sub"])
        sub_spec["_variant_body"] = C.ESPEAK_VARIANTS.get(sub_spec.get("variant", ""), "")
    chunks, notes = T.prepare(entry["say"], spec["engine"], spec["voice"])
    if not chunks:
        raise S.SynthError(f"{entry['id']}: nothing to say")
    pad = int(0.010 * SR)
    mains, subs = [], []
    for chunk in chunks:
        x, sr = S.synth(chunk, spec, tmp)
        x = D.remove_dc(D.resample(x, sr))
        act = D.find_active(x, SR, thresh_db=-50.0, rel=True)
        if act is None:
            raise S.SynthError(f"{entry['id']}: engine returned silence for {chunk!r}")
        a, b = max(0, act[0] - pad), min(len(x), act[1] + pad)
        mains.append(D.fade(x[a:b], 3.0, 6.0))
        if sub_spec is not None:
            y, sr2 = S.synth(chunk, sub_spec, tmp)
            y = D.remove_dc(D.resample(y, sr2))
            if abs(len(y) - len(x)) > 0.02 * SR:
                raise S.SynthError(f"{entry['id']}: sub-octave render is not time-aligned ({len(y)} vs {len(x)} samples)")
            y = np.pad(y, (0, max(0, len(x) - len(y))))[: len(x)]
            subs.append(D.fade(y[a:b], 3.0, 6.0))
    pause = cast.get("pause", 0.4) * delivery.get("pause_mul", 1.0)
    dry = D.concat_with_pauses(mains, [pause] * (len(mains) - 1))
    sub = D.concat_with_pauses(subs, [pause] * (len(subs) - 1)) if subs else None
    return dry, sub, chunks, notes, delivery


# ----------------------------------------------------------------------------
# finishing
# ----------------------------------------------------------------------------


def finalize(x: np.ndarray, ceiling_db: float = CEILING_DB, gain_trim_db: float = 0.0) -> np.ndarray:
    """DC-free, -16 LUFS, true peak under the ceiling, 30 ms of silence and a fade at each end."""
    x = D.highpass(D.remove_dc(x), 30.0, order=2)
    y, _ = D.normalize(x, TARGET_LUFS, ceiling_db)
    y = D.tidy_edges(y, SR, EDGE_PAD_MS, EDGE_FLOOR_DB)
    # trimming moves the gating blocks a little: re-trim the gain, then re-tidy at the final level
    y, _ = D.normalize(y, TARGET_LUFS + gain_trim_db, ceiling_db)
    return D.tidy_edges(y, SR, EDGE_PAD_MS, EDGE_FLOOR_DB)


def encode_ogg(wav: str, ogg: str) -> None:
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", wav,
           "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
           "-ac", "1", "-ar", str(SR), "-c:a", "libvorbis", "-q:a", VORBIS_Q, ogg]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg failed for {ogg}: {r.stderr.strip()[:400]}")


def render(job: tuple) -> dict:
    """Worker: one dialogue entry -> one OGG. Returns a result/diagnostics dict."""
    entry, tmp, espeak_path, out_dir = job
    eid = entry["id"]
    try:
        cast = C.CAST[entry["who"]]
        dry, sub, chunks, notes, delivery = synth_dry(entry, tmp, espeak_path)
        os.makedirs(os.path.join(tmp, "dry"), exist_ok=True)
        sf.write(os.path.join(tmp, "dry", eid + ".wav"), dry.astype(np.float32), SR, subtype="FLOAT")

        params = dict(cast.get("fx_params", {}))
        params.update(cast.get("fx_overrides", {}).get(delivery["name"], {}))
        if delivery.get("effort_db") and cast["fx"] == "near":
            params["effort_db"] = delivery["effort_db"]
        if sub is not None:
            params["_sub"] = sub
        wet = F.apply(cast["fx"], F.tone(dry, cast.get("tone")), params, eid)

        os.makedirs(os.path.join(tmp, "final"), exist_ok=True)
        wav = os.path.join(tmp, "final", eid + ".wav")
        ogg_tmp = os.path.join(tmp, "final", eid + ".ogg")
        ceiling, gain_trim = CEILING_DB, 0.0
        for attempt in range(5):
            y = finalize(wet, ceiling, gain_trim)
            sf.write(wav, y.astype(np.float32), SR, subtype="FLOAT")
            encode_ogg(wav, ogg_tmp)
            dec, dsr = sf.read(ogg_tmp, dtype="float64")
            if dec.ndim > 1 or dsr != SR:
                raise RuntimeError(f"encoder produced {dsr} Hz / {dec.ndim} dims")
            m = loudness(dec, SR)
            tp = true_peak_db(dec, SR)
            ok_peak = tp <= PEAK_LIMIT_DB
            ok_loud = abs(m["lufs"] - TARGET_LUFS) <= 0.25
            if ok_peak and ok_loud:
                break
            if not ok_peak:
                ceiling -= (tp - PEAK_LIMIT_DB) + 0.15
            if not ok_loud:
                gain_trim += TARGET_LUFS - m["lufs"]
        os.makedirs(out_dir, exist_ok=True)
        final = os.path.join(out_dir, eid + ".ogg")
        shutil.copyfile(ogg_tmp, final + ".part")
        os.replace(final + ".part", final)
        return {
            "id": eid, "who": entry["who"], "ok": True,
            "dur": round(len(dec) / SR, 3), "lufs": round(m["lufs"], 2), "method": m["method"],
            "tp": round(tp, 2), "bytes": os.path.getsize(final), "attempts": attempt + 1,
            "delivery": delivery["name"], "chunks": chunks, "notes": notes,
            "engine": cast["synth"]["engine"], "fx": cast["fx"], "text": entry["text"],
        }
    except Exception as exc:  # report, do not kill the whole batch
        return {"id": eid, "who": entry["who"], "ok": False, "error": f"{type(exc).__name__}: {exc}"}


# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------


def write_manifest(results: list[dict], entries: list[dict], partial: bool) -> int:
    """{id: {dur, who}} in dialogue order. With --only, untouched ids keep their old values."""
    old = {}
    if partial and os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as fh:
            old = json.load(fh)
    new = {r["id"]: {"dur": r["dur"], "who": r["who"]} for r in results if r["ok"]}
    manifest = {}
    for e in entries:
        if e["id"] in new:
            manifest[e["id"]] = new[e["id"]]
        elif e["id"] in old and os.path.exists(os.path.join(OUT_DIR, e["id"] + ".ogg")):
            manifest[e["id"]] = old[e["id"]]
    with open(MANIFEST + ".part", "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(MANIFEST + ".part", MANIFEST)
    return len(manifest)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", metavar="ID_PREFIX", action="append",
                    help="only (re)generate ids starting with this prefix (repeatable)")
    ap.add_argument("--list", action="store_true", help="print what would be rendered and exit")
    ap.add_argument("--tmp", default=default_tmp(), help="scratch directory (default: %(default)s)")
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 2)
    ap.add_argument("--fresh", action="store_true", help="ignore cached engine output")
    ap.add_argument("--prune", action="store_true", help="delete .ogg files in public/audio/vo that no id maps to")
    ap.add_argument("-q", "--quiet", action="store_true")
    args = ap.parse_args(argv)

    entries = load_entries()
    selected = [e for e in entries if not args.only or any(e["id"].startswith(p) for p in args.only)]
    if args.only and not selected:
        print(f"no ids start with {args.only}", file=sys.stderr)
        return 2

    if args.list:
        for e in selected:
            cast = C.CAST[e["who"]]
            d = C.delivery_for(e["who"], e["kind"], e["group"])
            chunks, notes = T.prepare(e["say"], cast["synth"]["engine"], cast["synth"]["voice"])
            print(f"{e['id']:22s} {e['who']:8s} {cast['synth']['engine']:8s} {d['name']:7s} {' | '.join(chunks)}")
        print(f"{len(selected)} of {len(entries)} lines")
        return 0

    S.check_tools(C.CAST[e["who"]]["synth"]["engine"] for e in selected)
    if args.fresh:
        shutil.rmtree(os.path.join(args.tmp, "synth"), ignore_errors=True)
    os.makedirs(args.tmp, exist_ok=True)
    espeak_path = None
    if any(C.CAST[e["who"]]["synth"]["engine"] == "espeak" for e in selected):
        espeak_path = S.espeak_setup(args.tmp, C.ESPEAK_VARIANTS)

    t0 = time.time()
    jobs = [(e, args.tmp, espeak_path, OUT_DIR) for e in selected]
    results = []
    with ProcessPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        for i, r in enumerate(pool.map(render, jobs, chunksize=2), 1):
            results.append(r)
            if not args.quiet:
                if r["ok"]:
                    print(f"[{i:3d}/{len(jobs)}] {r['id']:22s} {r['who']:8s} {r['dur']:6.2f}s {r['lufs']:6.2f} LUFS"
                          f"{'*' if r['method'] != 'r128' else ' '} tp {r['tp']:5.2f}  {r['bytes'] / 1024:5.1f} kB", flush=True)
                else:
                    print(f"[{i:3d}/{len(jobs)}] {r['id']:22s} FAILED: {r['error']}", flush=True)

    failed = [r for r in results if not r["ok"]]
    n_manifest = write_manifest(results, entries, partial=bool(args.only))

    # run report for the companion tools (not part of the repo)
    report_path = os.path.join(args.tmp, "report.json")
    report = {}
    if args.only and os.path.exists(report_path):
        with open(report_path, encoding="utf-8") as fh:
            report = json.load(fh)
    report.update({r["id"]: r for r in results})
    with open(report_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=1)

    ids = {e["id"] for e in entries}
    stale = sorted(f for f in os.listdir(OUT_DIR) if f.endswith(".ogg") and f[:-4] not in ids) if os.path.isdir(OUT_DIR) else []
    if stale and args.prune:
        for f in stale:
            os.unlink(os.path.join(OUT_DIR, f))

    ok = [r for r in results if r["ok"]]
    total = sum(os.path.getsize(os.path.join(OUT_DIR, f)) for f in os.listdir(OUT_DIR) if f.endswith(".ogg"))
    print(f"\nrendered {len(ok)}/{len(jobs)} lines in {time.time() - t0:.1f}s -> {os.path.relpath(OUT_DIR, REPO)}/ "
          f"({sum(r['bytes'] for r in ok) / 1e6:.2f} MB this run, {total / 1e6:.2f} MB in folder)")
    print(f"manifest: {os.path.relpath(MANIFEST, REPO)} ({n_manifest} entries)")
    if ok:
        fb = [r["id"] for r in ok if r["method"] != "r128"]
        if fb:
            print(f"loudness fallback (clip shorter than one 400 ms gating block): {', '.join(fb)}")
        fired = sorted({n for r in ok for n in r["notes"]})
        if fired and not args.quiet:
            print("pronunciation rules used:")
            for n in fired:
                print("  " + n)
    if stale:
        print(("pruned" if args.prune else "stale (no matching id; --prune deletes)") + ": " + ", ".join(stale))
    if failed:
        print(f"{len(failed)} FAILED: " + ", ".join(r["id"] for r in failed), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
