"""Offline FluidSynth rendering (one Part -> one 32-bit float stereo WAV).

FluidSynth's own reverb and chorus are switched off: they are modulated by
free-running LFOs, which makes two passes of the same loop render differently
(see fx.py for the linear, loop-exact replacements used by the mixer).
"""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess

import numpy as np
import soundfile as sf

from . import SOUNDFONT, SR

SYNTH_GAIN = 0.5
SYNTH_ARGS = ["-o", "synth.polyphony=512", "-o", "synth.reverb.active=0",
              "-o", "synth.chorus.active=0"]


def render_midi(mid_path: str, wav_path: str, cache_dir: str | None = None,
                min_samples: int = 0) -> np.ndarray:
    """Render a MIDI file with FluidSynth; returns float32 array (n, 2).

    Results are cached by content hash (MIDI bytes + synth settings) so that
    rebuilding after editing one part only re-renders that part.  The cache
    lives in the temp dir and is only an optimisation.
    """
    cmd = ["fluidsynth", "-ni", "-q", "-g", str(SYNTH_GAIN), "-r", str(SR),
           "-O", "float", "-T", "wav", *SYNTH_ARGS, "-F", wav_path, SOUNDFONT, mid_path]
    cached = None
    if cache_dir:
        h = hashlib.sha1()
        with open(mid_path, "rb") as f:
            h.update(f.read())
        h.update(" ".join(cmd[:-4]).encode())
        h.update(str(os.stat(SOUNDFONT).st_size).encode())
        os.makedirs(cache_dir, exist_ok=True)
        cached = os.path.join(cache_dir, h.hexdigest() + ".wav")
        if os.path.exists(cached):
            shutil.copyfile(cached, wav_path)
    if not (cached and os.path.exists(cached)):
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if res.returncode != 0 or not os.path.exists(wav_path):
            raise RuntimeError(f"fluidsynth failed for {mid_path}:\n{res.stderr[-2000:]}")
        if cached:
            shutil.copyfile(wav_path, cached)
    x, sr = sf.read(wav_path, dtype="float32", always_2d=True)
    if sr != SR:
        raise RuntimeError(f"unexpected sample rate {sr}")
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    if x.shape[0] < min_samples:
        x = np.vstack([x, np.zeros((min_samples - x.shape[0], 2), np.float32)])
    return x
