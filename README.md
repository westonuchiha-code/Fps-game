# EVERYTHING MUST GO

*(working title)* — a single-player, campaign-driven looter FPS that looks like a cel-shaded
PlayStation 2 game: chunky low-poly models, flat toon ramps, thick ink outlines.

You are **Clearance**, the last union's one deniable field agent, taking on **MonoMart —
"The Only Store™"** and its army of smiling AI Associates. The full vision, world and campaign
outline live in [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md).

It runs in any modern desktop browser. Nothing to install except Node.

```bash
npm install
npm run dev        # http://localhost:5173           the game
                   # http://localhost:5173/#editor   the level editor
                   # http://localhost:5173/#anim     the animation editor
                   # http://localhost:5173/#tex      the texture editor
npm run build      # static build in dist/ (host it anywhere)
npm run single     # the whole game as ONE file: release/everything-must-go.html
                   # (download it, double-click it, play — no server needed)
npm run handheld   # release/handheld.html: the same game inside a test rig with two on-screen
                   # controllers, for trying it on a phone (see tools/handheld/)
```

## What is in the game right now

- **Mission 01 "Receiving"** — parking lot, loading docks, container yard, a gate you have to blow
  with remote charges, a motor pool, a 340 m vehicle run down a canyon and a boss fight against
  the Regional Manager. Intro and ending cutscenes with voiced dialogue.
- **Gunplay** — four weapon classes (pistol, auto rifle, pump shotgun, bolt-action sniper), each
  with draw, holster, fire, tactical and empty reload, melee and inspect animations; aim down
  sights, recoil, spread bloom, tracers, shell casings.
- **Borderlands-style loot** — guns are rolled from parts (barrel, magazine, stock, sight,
  accessory) across four brands, five rarities and three elements, plus legendaries with unique
  effects; recharging shields; item cards with comparison arrows; parcel-locker loot chests.
- **Remote mines** — stick them to anything (including enemies), then squeeze the detonator
  wristwatch. The watch on your wrist shows how many charges you carry and how many are planted.
- **Enemies with squad AI** — Associates, shielded Supervisors, courier drones and the Regional
  Manager mech. They take cover, peek, advance when you hide, fall back when hurt, rout when
  their supervisor dies, and run from planted charges and oncoming vehicles.
- **Allies** — Local 404 Strikers follow you, fight from cover and crew your vehicle's gun.
- **Vehicles** (third person) — the **Teamster** 4x4 with a rear turret and the **Vesper**
  hover scooter with twin blasters.
- **Wristwatch menu**, backpack screen, mission report and gamepad support.

## Controls

| | Keyboard / mouse | Gamepad |
| --- | --- | --- |
| Move / look | WASD / mouse | left / right stick |
| Fire / aim | LMB / RMB | RT / LT |
| Jump, mantle | Space | A |
| Sprint | Shift | L3 |
| Crouch, slide (while sprinting) | C or Ctrl | B |
| Reload | R | X |
| Use, pick up (tap = take, hold = equip) | E | X |
| Melee | F | R3 |
| Throw charge | G | LB |
| Detonate (watch) | Q | RB |
| Weapons | 1–4, mouse wheel | Y, d-pad ←/→ |
| Inspect weapon | T | d-pad ↑ |
| Backpack | Tab | Back |
| Pause (watch menu) | Esc | Start |
| Vehicles | W/S throttle, steer with the camera (A/D to trim), Space handbrake, Shift boost (Vesper), LMB blasters (Vesper), H horn, E exit | |

## The level editor

Open **`/#editor`** (or pick *Level Editor* in the watch menu). It is a desktop tool: it wants a
mouse and a keyboard. Levels are plain JSON files in [`public/levels/`](public/levels); the format
is documented in [`src/world/leveldata.ts`](src/world/leveldata.ts).

- **Place** shapes, 33 props, enemies, allies, pickups, lockers, explosive barrels, vehicles,
  triggers, checkpoints and nav areas from the palette on the left: click an item, then click in
  the world (Shift keeps placing, R turns it). Move / rotate / scale with the handles (keys 1 / 2 /
  3), with grid and angle snapping. Undo is Ctrl+Z.
- **Look around**: right-drag to look, WASD to fly, wheel to zoom, F to frame the selection, T for
  the map view. Press H for the full cheat-sheet.
- **Logic without code**: a trigger (or a destroyed object, or "every enemy with tag X is dead")
  runs a list of actions — spawn a wave, play a voice line, add or complete an objective, open a
  gate, set a checkpoint, change the music, end the mission. The actions editor offers pick-lists
  of the tags, names, voice lines and music that actually exist.
- **▶ PLAY** (F5) drops you straight into the level; **FROM HERE** (Shift+F5) starts you where the
  camera is looking. F4 in the game brings you back to the editor with the level as you left it.
- **Saving**: with `npm run dev` running, Save writes into `public/levels/` so the level becomes
  part of the game. On a static host it saves in the browser, and Export / Import move the file.
  Everything is autosaved as you work.
- The **Problems** chip in the status bar lists things that would break a level (no player start,
  a trigger that spawns a tag nobody has, …); click a problem to select the object.
- `sandbox.json` is a small example level with two waves, a gate and a boss — open it to see how
  the logic is wired. `m01.json` is the real first mission — open it and change it.
  (`tools/levels/gen_m01.mjs` produced the first draft; re-running it overwrites the file.)
- Play any level directly with `/?level=<id>`; `/?level=test` is a developer sandbox yard.

## How it is put together

```
src/
  core/        input (keyboard, mouse, gamepad), math, events, shared types
  render/      cel-shading + ink pipeline, toon materials, procedural textures, sky, effects,
               Kit (the low-poly mesh builder every model is made with)
  world/       level geometry builder, collision (BVH), level file format + loader, props
  player/      movement controller, first-person arms and viewmodel
  weapons/     item generation, gun models, animation system and clips, firing, mines
  loot/        pickups, lockers, inventory
  ai/          navigation grid, character models, NPC bodies, brains, drones, director
  vehicles/    rigid body, Teamster, Vesper, chase camera
  story/       cutscenes
  levels/      mission scripts (what a level file cannot express)
  ui/          HUD, item cards, watch menu, backpack, mission report
  editor/      the level editor
tools/
  shot.mjs     headless screenshot / scripted play-test harness
  smoke.mjs    real-input smoke test (npm test)
  check.mjs    scripted gameplay checks, one per file in checks/ (npm run check)
  editor-shot.mjs   level-editor test suite + screenshots
  levels/      level generators
  music/ sfx/ voice/   the pipelines that produced everything under public/audio
```

**Every model is generated in code** and **all audio is generated by the scripts in `tools/`**
(music: original compositions rendered with FluidSynth; voice: text-to-speech placeholders;
effects: synthesised). See [`CREDITS.md`](CREDITS.md). To replace a voice line with a real
recording, drop a file with the same name into `public/audio/vo/`.

### Testing without playing

With `npm run dev` running in another terminal:

```bash
npm test             # real-input smoke test: boots like a player, clicks through the menu,
                     # skips the intro, moves, shoots, reloads, pauses, opens the backpack
npm run check        # scripted gameplay checks (tools/checks/*.js): combat, loot, charges,
                     # respawn, and Mission 01's gate / boss / ending logic
node tools/editor-shot.mjs   # the level editor: places every object with real clicks, edits,
                     # undoes, saves, reloads, play-tests and comes back (needs the dev server)
npm run typecheck
```

All of them fail on any console error. The first two also run against a production build, which
is steadier while files are being edited: `npm run build && npx vite preview --port 4173`, then
`GAME_URL=http://localhost:4173/ npm test`. To poke at something by hand, `tools/shot.mjs` drives the real
game in headless Chromium and saves a screenshot:

```bash
node tools/shot.mjs --url "?auto=1&dev=1&level=m01&nointro=1" --out shots/x.png \
  --eval "game.manual = true; game.debug.tp(0, 0.1, -40, 0); game.step(60, 1/60); return game.ai.aliveEnemies()"
```

`game.debug` (see `src/dev/debug.ts`) has helpers to teleport, hold inputs, run a simple bot,
view the first-person rig from outside and take bird's-eye shots of a level.

## Status and what is next

This is an early build: one mission, placeholder voices, and a lot of tuning still to do.
Planned next, roughly in order: missions 2–3, vending kiosks, more legendaries, enemy vehicles,
the finale in the MonoMart Tower against Max Price's robotic CEO chassis.

## Animation editor

Open **`/#anim`**. It shows one character driven by the game's own animation code. The sliders on
the left set its base motion (aim, run speed, crouch, aim up/down); a clip is layered on top.

- Pick a **clip** (or type a name and press *New*). Set its length, whether it loops and which
  characters it plays on.
- **Click a joint** (or the rifle) and drag the gizmo rings, or type angles on the right. Every
  change writes a key at the playhead; keys show as diamonds on the timeline (drag them to retime).
- *Left hand: grip → magazine* moves a worker's off hand from the handguard to the magazine.
- **Space** plays, **K** adds a key, **, .** jump between keys, **Ctrl+Z** undoes, **Ctrl+S** saves,
  **R** switches the rifle gizmo between move and turn. *Mirror* swaps left and right; *Copy / Paste
  pose* carries a pose to another time or clip; *Fades* previews the blend the game uses.
- **Save** writes `public/anims/clips.json` (dev server); on a static host it downloads the file.

The game plays clips by name (`npc.anim.play('reload')`): workers change magazines every few bursts.

`node tools/anim-sheet.mjs --clips reload --cast 2,3 --times 0,0.25,0.5,0.75,1 --yaws 35,-60` renders a
contact sheet into `shots/anim-sheet.png` (dev server running).

## Texture editor

Open **`/#tex`**. Every texture in the game is a *surface*: a stack of procedural layers (noise,
speckle, blotches, lines, weave, grids, stripes, scratches, cracks, stitches, dots, gradients, and
the original hand-made textures as a starting layer).

- **Surfaces tab.** Pick a surface on the left (*Models* = characters, guns, vehicles; *World* =
  level geometry). Add layers, reorder them, hide them, and tune each one; the tile in the middle
  and the model in the 3D view update as you go. *Tint* previews it under a different paint colour;
  *Show on* picks the model. *Repeats per metre* sets how big the pattern is on models.
- **Decals tab.** Stamps are drawn from shapes and text (in the game's fonts). Choose a character
  under *Show on*, press *Place*, and click the model to stick the stamp on; then resize, turn or
  swap it. Decals follow the bone they sit on.
- **Save** (or Ctrl+S) writes `public/textures/surfaces.json` / `decals.json` on the dev server;
  elsewhere it downloads the file. Ctrl+Z undoes; unsaved work is kept in the browser until you save
  or revert.

Which surface a model part uses comes from its colour (`kit.surfMap`, or the palette defaults in
`COLOR_SURF` in `src/render/surfaces.ts`), so a new model is textured the moment it uses the palette.
