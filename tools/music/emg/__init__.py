"""EVERYTHING MUST GO -- music toolchain.

Small, dependency-light library used by tools/music/build.py:

  theory.py  note names <-> MIDI numbers
  seq.py     Song / Part: a tiny score model (notes, CCs, pitch bends in beats)
             with swing, humanisation, loop wrapping and SMF export
  synth.py   offline FluidSynth rendering of one Part to a float WAV
  dsp.py     loudness (BS.1770), true peak, filters, compressor, limiter,
             seam utilities
  mix.py     auto-balanced mixdown, mastering, loop extraction, OGG encode
  lint.py    score sanity checks (ranges, clashes, static sections)
"""

SR = 44100
SOUNDFONT = "/usr/share/sounds/sf2/FluidR3_GM.sf2"
