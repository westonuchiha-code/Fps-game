# EVERYTHING MUST GO — notes for working on this repo

Single-player, campaign FPS in the browser: TypeScript + Three.js + Vite. The owner's creative
brief and the world/campaign bible are in `docs/GAME_DESIGN.md` — read it before making content
decisions. The short version of the brief:

- Cel-shaded, low-poly, "PlayStation 2 version of Borderlands"; modern controls and game feel.
- Borderlands-style loot. Few guns, done really well, with real reload/draw/fire animations.
- Slight GoldenEye 007 flavour: spy music, wristwatch menu, remote mines detonated by the watch.
- Halo 1/2 mission structure (short voiced cutscene, then play), friendly squadmates, two
  vehicles driven in third person (Warthog-like 4x4, floating Vespa-like scooter).
- Villains: MonoMart, a hyper-capitalist megacorp of smiling robots; finale vs a robotic CEO.
- Scope cap: no bigger than Halo CE. Focus on cool level layouts and fun gunplay.
- The owner wants tools: keep the level editor working and levels data-driven.
- The owner likes progress screenshots during long work sessions.

## Conventions

- **All art is procedural.** Build models with `Kit` (`src/render/kit.ts`) and colours from `PAL`
  (`src/render/toon.ts`); level geometry goes through `GeoBuilder`. Ink outlines come from the
  post-process, so flat-shaded boxes with good silhouettes are the style.
- **Everything original.** Music must not quote existing themes; names and logos are invented.
- **Levels are data** (`public/levels/*.json`, format in `src/world/leveldata.ts`). Put layout,
  spawns, triggers and simple logic in the file; use a script in `src/levels/` only for what the
  action list cannot express. Keep the editor (`src/editor`) in step with any format change.
- **Audio is generated** by `tools/music`, `tools/sfx`, `tools/voice` (Python; they need
  fluidsynth + FluidR3_GM, sox, ffmpeg, pico2wave, RHVoice, espeak-ng, flite). Dialogue text
  lives in `src/data/dialogue.json`; re-run `tools/voice/gen_voice.py` after editing it.
- The global game instance is `G` (`src/core/globals.ts`). No per-frame allocations in hot paths.
- **One page, two apps.** `index.html` loads `src/shell.ts`, which starts the level editor when the
  address ends in `#editor` and the game otherwise. They hand over through `src/core/nav.ts`
  (`openEditor()`, `openGame(note)`), never through query strings or separate pages, so the pair
  also works on hosts that only serve one page. Wrap every browser-storage access in try/catch.

## Verifying changes

There is no way to "just play" in CI, so drive the real game headlessly:

```bash
npm run dev                      # must be running
node tools/shot.mjs --url "?auto=1&dev=1&level=m01&nointro=1" --out shots/x.png --eval "<js>"
```

In the eval, `game` is the Game; set `game.manual = true` and advance with
`game.step(frames, 1/60)`. `game.debug` (`src/dev/debug.ts`) has `tp`, `lookAt`, `run`
(hold inputs), `botFight`, `gun`, `pose`, `rigView`, `overview`, `cam`. Look at the screenshot.
`npm run typecheck` must pass; `npm run build` must succeed. `npm test` (real-input smoke test)
and `npm run check` (scripted gameplay checks in `tools/checks/`) must pass; add a check when you
add a mechanic. `node tools/editor-shot.mjs` covers the level editor (dev server only). Checks are flaky while files are being saved (Vite reloads the page): run them
against a build instead with `npm run build && npx vite preview --port 4173` and
`GAME_URL=http://localhost:4173/ npm test`.
