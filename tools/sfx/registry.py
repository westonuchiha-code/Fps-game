"""Registry that maps a sound name from spec.py to its synthesis function."""
from __future__ import annotations

from typing import Callable

# name -> (function(rng, jit, variation_index) -> np.ndarray, fade_out_seconds or None, rotate_loop)
REGISTRY: dict[str, tuple[Callable, float | None, bool]] = {}


def sound(name: str, fade: float | None = None, rotate: bool = True):
    """Register a recipe.

    The function receives ``(rng, j, v)``: a seeded numpy Generator, a ``dsp.Jit``
    parameter-jitter helper bound to that generator, and the 0-based variation
    index.  It returns a mono float array at 44.1 kHz.

    One-shots are trimmed, faded (``fade`` seconds; default scales with the
    length) and peak-normalised by gen_sfx.py.  Loops must already be exactly
    periodic; gen_sfx.py may rotate them (start the file at a different point of
    the cycle) to put the loop point where the codec reproduces it best - pass
    ``rotate=False`` if the position of events inside the loop matters.
    """

    def deco(fn: Callable) -> Callable:
        if name in REGISTRY:
            raise ValueError(f"sound {name!r} registered twice")
        REGISTRY[name] = (fn, fade, rotate)
        return fn

    return deco
