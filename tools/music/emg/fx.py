"""Send effects rendered in the mixer instead of inside FluidSynth.

FluidSynth's built-in reverb and chorus are modulated by free-running LFOs, so
two identical passes of a loop never render identically and a loop cut out of
them cannot be sample-exact.  These replacements are strictly linear and
(for loops) exactly periodic:

* reverb  = convolution with a synthetic stereo impulse response
            (exponentially decaying noise, frequency dependent decay time,
            sparse early reflections, pre-delay) -- circular convolution for
            loops, so the tail of the loop end lands on the loop start;
* chorus  = two modulated delay taps whose LFO rates are snapped to a whole
            number of cycles per loop.

The MIDI files still carry the arranger's CC91 / CC93 send values; the mixer
reads the very same numbers to set these sends.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
from scipy import fft, signal

from . import SR

# name -> impulse response recipe
SPACES = {
    # big, dark-ish scoring hall: orchestra, leads, mallets
    "hall": dict(rt60=1.85, predelay=0.022, lowcut=230.0, highcut=8500.0, seed=4041,
                 early=9, early_gain=0.9, build=0.045),
    # tight wooden room: drum kit and hand percussion
    "room": dict(rt60=0.62, predelay=0.006, lowcut=180.0, highcut=10500.0, seed=4042,
                 early=7, early_gain=1.3, build=0.012),
    # long, bright plate for stingers and special moments
    "plate": dict(rt60=2.4, predelay=0.012, lowcut=300.0, highcut=9500.0, seed=4043,
                  early=5, early_gain=0.6, build=0.03),
}

# decay-time multiplier per octave band (air and wall absorption)
_BANDS = [(125.0, 1.10), (250.0, 1.08), (500.0, 1.0), (1000.0, 0.95), (2000.0, 0.82),
          (4000.0, 0.64), (8000.0, 0.44), (16000.0, 0.30)]


@lru_cache(maxsize=None)
def impulse_response(space: str) -> np.ndarray:
    """Deterministic stereo impulse response, unit energy per channel."""
    p = SPACES[space]
    rng = np.random.default_rng(p["seed"])
    n_pre = int(p["predelay"] * SR)
    n = int(p["rt60"] * 1.35 * SR)
    t = np.arange(n) / SR
    # late field: decorrelated noise with a little shared (centre) content
    noise = rng.standard_normal((n, 2)) * 0.92 + rng.standard_normal((n, 1)) * 0.38
    spec = fft.rfft(noise, axis=0)
    f = fft.rfftfreq(n, 1.0 / SR)
    lf = np.log2(np.maximum(f, 1.0))
    late = np.zeros((n, 2))
    centres = np.log2([b[0] for b in _BANDS])
    for i, (fc, mult) in enumerate(_BANDS):
        # raised-cosine band masks in log-frequency that sum to one
        c = centres[i]
        w = np.clip(1.0 - np.abs(lf - c), 0.0, 1.0)
        mask = 0.5 - 0.5 * np.cos(np.pi * w)
        if i == 0:
            mask[lf <= c] = 1.0
        if i == len(_BANDS) - 1:
            mask[lf >= c] = 1.0
        band = fft.irfft(spec * mask[:, None], n=n, axis=0)
        rt = p["rt60"] * mult
        late += band * np.exp(-6.907755 * t / rt)[:, None]
    # diffuse field builds up instead of starting as a noise burst
    nb = int(p["build"] * SR)
    late[:nb] *= (np.sin(0.5 * np.pi * np.arange(nb) / nb) ** 2)[:, None]
    late /= np.sqrt((late ** 2).sum(axis=0))
    # sparse early reflections (different pattern per ear)
    early = np.zeros((n, 2))
    for ch in range(2):
        times = np.sort(rng.uniform(0.004, 0.075, p["early"]))
        for k, tt in enumerate(times):
            amp = (0.75 ** k) * rng.choice([-1.0, 1.0]) * rng.uniform(0.7, 1.0)
            early[int(tt * SR), ch] += amp
    early /= np.sqrt((early ** 2).sum(axis=0))
    ir = late + early * 0.33 * p["early_gain"]
    ir = np.vstack([np.zeros((n_pre, 2)), ir])
    sos = signal.butter(2, p["lowcut"], "highpass", fs=SR, output="sos")
    ir = signal.sosfilt(sos, ir, axis=0)
    sos = signal.butter(1, p["highcut"], "lowpass", fs=SR, output="sos")
    ir = signal.sosfilt(sos, ir, axis=0)
    # fade the very end to zero and normalise
    fo = int(0.05 * SR)
    ir[-fo:] *= np.linspace(1.0, 0.0, fo)[:, None]
    ir /= np.sqrt((ir ** 2).sum(axis=0))
    return ir


def send_gain(cc: float) -> float:
    """CC91 value (0..127) -> linear send gain.

    The reverb impulse responses have unit energy, so gain**2 is the wet/dry
    energy ratio: 127 -> -6 dB, 100 -> -10.7 dB, 64 -> -16.9 dB, 32 -> -22.5 dB.
    """
    if cc <= 0:
        return 0.0
    return 10.0 ** ((-28.0 + 22.0 * cc / 127.0) / 20.0)


def reverb(send: np.ndarray, space: str, periodic: bool) -> np.ndarray:
    """Wet signal for a stereo send bus (mono-summed in, stereo out)."""
    ir = impulse_response(space)
    mono = send.mean(axis=1)
    n = len(mono)
    if periodic:
        # circular convolution == steady state of the endlessly repeating loop
        m = len(ir)
        if m > n:
            raise ValueError("loop shorter than the reverb tail")
        h = np.zeros((n, 2))
        h[:m] = ir
        spec = fft.rfft(mono)[:, None] * fft.rfft(h, axis=0)
        return fft.irfft(spec, n=n, axis=0)
    out = np.stack([signal.fftconvolve(mono, ir[:, c])[:n] for c in range(2)], axis=1)
    return out


def chorus(x: np.ndarray, amount: float, periodic: bool) -> np.ndarray:
    """Stereo chorus: one modulated tap per side.  amount = CC93 / 127."""
    if amount <= 0:
        return x
    n = len(x)
    t = np.arange(n, dtype=np.float64)
    dur = n / SR
    taps = [(0.57, 12.5, 2.3, 0.0, 0), (0.81, 17.0, 2.9, 1.9, 1)]   # Hz, ms, ms, phase, channel
    out = x.copy()
    g = 0.75 * amount
    mono = x.mean(axis=1)
    for rate, base, depth, ph, ch in taps:
        if periodic:
            rate = max(1.0, round(rate * dur)) / dur      # whole cycles per loop
        d = (base + depth * np.sin(2 * np.pi * rate * t / SR + ph)) * SR / 1000.0
        pos = t - d
        i0 = np.floor(pos).astype(np.int64)
        fr = pos - i0
        if periodic:
            a = mono[i0 % n]
            b = mono[(i0 + 1) % n]
        else:
            valid = i0 >= 0
            i0c = np.clip(i0, 0, n - 1)
            i1c = np.clip(i0 + 1, 0, n - 1)
            a = np.where(valid, mono[i0c], 0.0)
            b = np.where(valid, mono[i1c], 0.0)
        out[:, ch] += g * (a * (1 - fr) + b * fr)
    return out
