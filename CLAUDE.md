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
- **Character animation is data plus code.** CharAnim (`src/ai/charModel.ts`) makes the base motion
  (walk, run, aim, crouch, hands solved onto the rifle); authored clips (`public/anims/clips.json`,
  format in `src/anim/clips.ts`) layer keyed offsets on top. Make and edit clips in the animation
  editor (`/#anim`, `window.__anim` for scripting) rather than typing poses into code, and judge them
  with `node tools/anim-sheet.mjs` (a contact sheet of characters x clips x moments).
- The owner likes progress screenshots during long work sessions.

## Conventions

- **All art is procedural.** Build models with `Kit` (`src/render/kit.ts`) and colours from `PAL`
  (`src/render/toon.ts`); level geometry goes through `GeoBuilder`. Ink outlines come from the
  post-process, so flat-shaded boxes with good silhouettes are the style.
- **Textures are recipes.** Every texture is a stack of procedural layers in
  `public/textures/surfaces.json` (format in `src/render/surfaces.ts`); decals (logos, badges,
  stencils, dirt) and where they sit on each model are in `public/textures/decals.json`
  (`src/render/decals.ts`). Kit models pick a surface per part through `kit.surfMap` (by colour),
  `kit.surf`, or the palette defaults in `COLOR_SURF`. Edit both in the texture editor (`/#tex`,
  `window.__tex` for scripting), not by hand-drawing in code.
- **Everything original.** Music must not quote existing themes; names and logos are invented.
- **Levels are data** (`public/levels/*.json`, format in `src/world/leveldata.ts`). Put layout,
  spawns, triggers and simple logic in the file; use a script in `src/levels/` only for what the
  action list cannot express. Keep the editor (`src/editor`) in step with any format change.
- **Audio is generated** by `tools/music`, `tools/sfx`, `tools/voice` (Python; they need
  fluidsynth + FluidR3_GM, sox, ffmpeg, pico2wave, RHVoice, espeak-ng, flite). Dialogue text
  lives in `src/data/dialogue.json`; re-run `tools/voice/gen_voice.py` after editing it.
- **No touch-screen code in the game.** It is a controller / keyboard-and-mouse game. For trying
  it on a phone there is a separate test rig, `tools/handheld/` (`npm run handheld`): it wraps the
  finished game in a page with two on-screen controllers and feeds it as an ordinary gamepad.
- The global game instance is `G` (`src/core/globals.ts`). No per-frame allocations in hot paths.
- **One page, four apps.** `index.html` loads `src/shell.ts`, which starts the level editor when the
  address ends in `#editor`, the animation editor at `#anim`, the texture editor at `#tex`, and the
  game otherwise. They hand over through `src/core/nav.ts`
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
