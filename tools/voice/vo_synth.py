"""Thin, cached wrappers around the four offline speech engines.

    pico     SVOX Pico      (pico2wave)     16 kHz   <pitch>/<speed> markup
    rhvoice  RHVoice        (RHVoice-test)  24 kHz   -r rate%  -t pitch%  -v volume%
    flite    CMU Flite      (flite)         16 kHz   duration_stretch only
    espeak   eSpeak NG      (espeak-ng)     22 kHz   -p pitch  -s speed  + voice variant

All four are deterministic (same text + settings -> same samples), so the
rendered WAV is cached under <tmp>/synth/ keyed by a hash of the request.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess

import numpy as np
import soundfile as sf

ENGINE_BIN = {"pico": "pico2wave", "rhvoice": "RHVoice-test", "flite": "flite", "espeak": "espeak-ng"}

# bump to invalidate every cached synth WAV (e.g. after changing a wrapper)
SYNTH_REV = 3


class SynthError(RuntimeError):
    pass


def check_tools(engines) -> None:
    missing = [ENGINE_BIN[e] for e in sorted(set(engines)) if shutil.which(ENGINE_BIN[e]) is None]
    for tool in ("ffmpeg",):
        if shutil.which(tool) is None:
            missing.append(tool)
    if missing:
        raise SynthError("missing tools: " + ", ".join(missing))


# ----------------------------------------------------------------------------
# eSpeak: private data directory holding our own voice variants
# ----------------------------------------------------------------------------


def espeak_system_data() -> str:
    out = subprocess.run(["espeak-ng", "--version"], capture_output=True, text=True, check=True).stdout
    m = re.search(r"Data at:\s*(\S+)", out)
    if not m or not os.path.isdir(m.group(1)):
        raise SynthError("cannot locate espeak-ng-data: " + out.strip())
    return m.group(1)


def espeak_setup(tmp: str, variants: dict[str, str]) -> str:
    """Build <tmp>/espeak/espeak-ng-data: symlinks to the system data plus our variants.

    eSpeak only loads voice variants from <data>/voices/!v, and that lives in
    a system directory we must not write to, so the pipeline points
    `espeak-ng --path` at a private mirror instead. Returns the --path value.
    """
    sysdir = espeak_system_data()
    root = os.path.join(tmp, "espeak")
    data = os.path.join(root, "espeak-ng-data")
    vdir = os.path.join(data, "voices", "!v")
    os.makedirs(vdir, exist_ok=True)

    def link(src, dst):
        if os.path.islink(dst):
            if os.readlink(dst) == src:
                return
            os.unlink(dst)
        elif os.path.exists(dst):
            return
        os.symlink(src, dst)

    for name in os.listdir(sysdir):
        if name != "voices":
            link(os.path.join(sysdir, name), os.path.join(data, name))
    for name in os.listdir(os.path.join(sysdir, "voices")):
        if name != "!v":
            link(os.path.join(sysdir, "voices", name), os.path.join(data, "voices", name))
    for name in os.listdir(os.path.join(sysdir, "voices", "!v")):
        if name not in variants:
            link(os.path.join(sysdir, "voices", "!v", name), os.path.join(vdir, name))
    for name, body in variants.items():
        path = os.path.join(vdir, name)
        text = f"language variant\nname {name}\n{body.strip()}\n"
        if os.path.islink(path):
            os.unlink(path)
        if not os.path.exists(path) or open(path, encoding="utf-8").read() != text:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(text)
    return root


# ----------------------------------------------------------------------------
# engines
# ----------------------------------------------------------------------------


def _run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, **kw)
    if r.returncode != 0:
        raise SynthError(f"{cmd[0]} failed ({r.returncode}): {r.stderr.decode(errors='replace')[:400]}")
    return r


def _pico(text, spec, out):
    body = text
    speed = int(round(spec.get("speed", 100)))
    pitch = int(round(spec.get("pitch", 100)))
    if speed != 100:
        body = f'<speed level="{speed}">{body}</speed>'
    if pitch != 100:
        body = f'<pitch level="{pitch}">{body}</pitch>'
    _run(["pico2wave", "-l", spec["voice"], "-w", out, body])


def _rhvoice(text, spec, out):
    cmd = ["RHVoice-test", "-p", spec["voice"], "-o", out,
           "-r", str(int(round(spec.get("rate", 100)))),
           "-t", str(int(round(spec.get("pitch", 100)))),
           "-v", str(int(round(spec.get("volume", 50))))]
    _run(cmd, input=(text + "\n").encode("utf-8"))


def _flite(text, spec, out):
    cmd = ["flite", "-voice", spec["voice"]]
    stretch = spec.get("stretch", 1.0)
    if abs(stretch - 1.0) > 1e-6:
        cmd += ["--setf", f"duration_stretch={stretch:.3f}"]
    _run(cmd + ["-t", text, "-o", out])


def _espeak(text, spec, out):
    voice = spec.get("voice", "en-us")
    variant = spec.get("variant")
    root = spec.get("_espeak_path")
    cmd = ["espeak-ng"]
    if root:
        cmd.append(f"--path={root}")
        if variant and not os.path.exists(os.path.join(root, "espeak-ng-data", "voices", "!v", variant)):
            raise SynthError(f"espeak variant {variant!r} not found under {root}")  # espeak itself fails silently
    cmd += ["-v", voice + (f"+{variant}" if variant else ""),
            "-p", str(int(round(spec.get("pitch", 50)))),
            "-s", str(int(round(spec.get("speed", 175)))),
            "-a", str(int(round(spec.get("amp", 60)))),
            "-g", str(int(round(spec.get("gap", 0)))),
            "-w", out, text]
    _run(cmd)


_ENGINES = {"pico": _pico, "rhvoice": _rhvoice, "flite": _flite, "espeak": _espeak}
_VOLUME_KEY = {"rhvoice": "volume", "espeak": "amp"}


def _clipped(path: str) -> bool:
    """True if the WAV has a run of >= 3 full-scale samples (the engine clipped)."""
    x, _ = sf.read(path, dtype="int16")
    full = np.abs(x.astype(np.int32)) >= 32766
    if not full.any():
        return False
    run = full[:-2] & full[1:-1] & full[2:]
    return bool(run.any())


def synth(text: str, spec: dict, tmp: str) -> tuple[np.ndarray, int]:
    """Render `text` with the engine described by `spec`; returns (mono float64, sample rate)."""
    engine = spec["engine"]
    key_spec = {k: v for k, v in spec.items() if not k.startswith("_")}
    extra = spec.get("_variant_body", "")
    key = hashlib.sha1(json.dumps([SYNTH_REV, key_spec, extra, text], sort_keys=True).encode("utf-8")).hexdigest()[:20]
    cdir = os.path.join(tmp, "synth")
    os.makedirs(cdir, exist_ok=True)
    out = os.path.join(cdir, f"{engine}-{key}.wav")
    if not os.path.exists(out):
        part = f"{out[:-4]}.{os.getpid()}.part.wav"  # pico2wave insists on a .wav suffix
        cur = dict(spec)
        vol_key = _VOLUME_KEY.get(engine)
        for attempt in range(4):
            _ENGINES[engine](text, cur, part)
            if not os.path.exists(part) or os.path.getsize(part) < 64:
                raise SynthError(f"{engine} produced no audio for {text!r}")
            if not _clipped(part):
                break
            if vol_key is None:
                raise SynthError(f"{engine} output is clipped for {text!r} and it has no volume control")
            default = 50 if engine == "rhvoice" else 60
            cur[vol_key] = cur.get(vol_key, default) * 0.7
        else:
            raise SynthError(f"{engine} output still clipped after lowering the volume: {text!r}")
        os.replace(part, out)
    x, sr = sf.read(out, dtype="float64")
    if x.ndim > 1:
        x = x.mean(axis=1)
    if len(x) < sr * 0.03:
        raise SynthError(f"{engine} returned {len(x)} samples for {text!r}")
    return x, sr
