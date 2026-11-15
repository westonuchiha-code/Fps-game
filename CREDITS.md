# Credits and licences

Everything in this repository was made for this project. Nothing was taken from an existing game.

## Art
All models, textures, signs and effects are generated in code (see `src/render`, `src/world/props.ts`,
`src/weapons/gunModels.ts`, `src/ai/charModel.ts`, `src/vehicles`).

## Music
Original compositions written as code in `tools/music/` and rendered with
[FluidSynth](https://www.fluidsynth.org/) using the **FluidR3_GM** General MIDI soundfont by
Frank Wen (MIT licence).

## Voice
Placeholder text-to-speech rendered by `tools/voice/` from `src/data/dialogue.json`, using
SVOX Pico (Apache-2.0), RHVoice, eSpeak NG and CMU Flite, then processed per character.
Intended to be replaced by recorded performances.

## Sound effects
Synthesised from scratch by `tools/sfx/` (NumPy / SciPy).

## Fonts (via Fontsource, SIL Open Font Licence 1.1)
Anton, Rajdhani, Special Elite, Share Tech Mono, Bangers.

## Code libraries
[three.js](https://threejs.org/) (MIT), [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) (MIT),
[Vite](https://vitejs.dev/) (MIT), TypeScript (Apache-2.0).
