# EVERYTHING MUST GO — game design (living document)

Working title. Single-player, campaign-driven, cel-shaded looter FPS.

## The brief (from the project owner)

- Single-player FPS with a campaign. Scope cap: **no bigger than Halo: Combat Evolved** —
  a small weapon set, a fixed enemy roster with distinct AI, and the effort spent on
  cool level layouts and fun gunplay.
- Look: **cel-shaded, low-poly — "a PlayStation 2 version of Borderlands"**. Ink outlines,
  flat toon ramps, chunky geometry.
- **Borderlands-style loot**: procedurally rolled guns, rarity colours, item cards.
- **Modern controls and game feel** (sprint, slide, mantle, ADS, snappy movement).
- Few guns, **done really well**: real reload, draw/holster and firing animations.
- **GoldenEye 007 flavour**: spy music, the menu lives on a **wristwatch**, and
  **remote mines** you stick anywhere and detonate with the watch.
- Enemies with decent AI that react to the player and their surroundings.
- Mission structure like **Halo 1/2**: short voiced setup cutscene, then you play.
- Factions like Wolfenstein: the villains are an authoritarian **hyper-capitalist megacorp**
  (an Amazon/Walmart-style AI conglomerate owned by a multi-trillionaire).
- Finale: storm the corporate tower and fight the **robotic CEO**.
- **Friendly AI squadmates** fight alongside you, like Halo's marines.
- **Two vehicles**, driven in third person like Halo: a Warthog-style 4x4 and a
  **floating Vespa-style hover scooter**.

## World

**MONOMART — "The Only Store™".** It bought the other stores, then the roads, then the
water, then the weather forecast. Founder and CEO **Maxwell "Max" Price**, the first
multi-trillionaire, replaced his entire workforce with smiling AI robots called
**Associates** and had himself uploaded into the company mainframe. MonoMart is cheerful,
polite and totalitarian: every threat is delivered in customer-service language.

**Local 404** — the last union ("Worker Not Found"). Laid-off humans in hi-vis vests and
hard hats, fighting from the back of union-made trucks. Rank-and-file fighters are
**Strikers**.

**You are "Clearance"** — a former MonoMart loss-prevention auditor turned Local 404's
one deniable field agent. Tuxedo under a hi-vis vest. Carries a detonator wristwatch.
Silent protagonist.

**Steward** — your handler on the radio. Dry, British, unflappable.

Tone: Saturday-morning satire with a spy-movie straight face. Enemies are robots, so the
violence is sparks, oil and flying parts rather than gore.

### Brand palette

| Thing | Colours |
| --- | --- |
| MonoMart | white/cream plastic shells, "smile yellow" `#FFD21F`, black screens/joints |
| MonoMart management | black shells, gold trim |
| Local 404 | hi-vis orange `#FF7A1A`, denim blue, rust red |
| World | warm desert/rust ground, teal-violet shadows, big flat sky |
| Ink | near-black outlines `#0B0B12` |

## Campaign outline (cap: 10 missions)

| # | Title | Beat | Status |
| --- | --- | --- | --- |
| 1 | **Receiving** | Breach Fulfillment Center 7's docks; first mines, first vehicle run, Regional Manager fight | **in development** |
| 2 | Sortation | Inside FC-7: conveyors, robot arms; destroy the control uplink | planned |
| 3 | Last Mile | Vehicle chase across the delivery flats | planned |
| 4 | Price Check | Firefights through a flagship Supercenter | planned |
| 5 | Returns Department | Rescue captured union members from the scrapyard | planned |
| 6 | The Cloud | MonoMart's server farm | planned |
| 7 | Black Friday | City uprising, large battle with allies and vehicles | planned |
| 8 | Hostile Takeover | Assault the MonoMart Tower plaza and lobby | planned |
| 9 | Golden Parachute | Up the executive floors | planned |
| 10 | Exit Interview | Boss: Max Price's robotic CEO chassis | planned |

## Enemy roster (fixed, Halo-style)

| Enemy | Role | Behaviour |
| --- | --- | --- |
| **Associate** | Rank-and-file rifle robot | Fights in squads, uses cover, panics and flees when its supervisor dies |
| **Supervisor** | Shielded elite | Recharging energy shield, aggressive, strafes, flanks, rallies Associates |
| **Courier drone** | Flying harasser | Hovers, strafes, dives; fragile |
| **Regional Manager** | Heavy mech / mini-boss | Slow, armoured front, cannon + stomp; weak point on its back |
| **The Founder** | Final boss | Max Price's CEO chassis (mission 10) |

All of them wear a screen for a face showing a yellow smile that changes with their state.

## Arsenal

Four weapon classes: **Pistol, Auto Rifle, Shotgun, Sniper** — each rolled from parts.

| Brand | Identity |
| --- | --- |
| **VALU-ARMS** | MonoMart house brand. Big mags, fast reloads, soft damage |
| **KRONA** | Precision import. Accurate, high crit, slow fire rate |
| **PICKET** | Union workshop iron. Heavy damage, heavy recoil |
| **ZAPP!** | Always elemental (incendiary / shock / corrosive) |

Rarity: Common (white) → Uncommon (green) → Rare (blue) → Epic (purple) → Legendary (orange).

Also: recharging **shields** as loot, **remote mines** ("severance packages") detonated
from the watch, cash, ammo, health.

## Vehicles

- **Teamster** — union 4x4 technical with a rear turret (driver + gunner + passenger).
- **Vesper** — MonoMart's last-mile delivery hover scooter. Fast, floaty, twin blasters.

## Audio direction

- Music: 1990s console spy score — sampled General-MIDI orchestra and band (timpani,
  brass stabs, tremolo strings, vibraphone, slap/fingered bass, twangy clean guitar,
  bongos, metallic percussion). **All compositions are original**; nothing quotes any
  existing theme.
- Voice: text-to-speech placeholders (robots sound robotic on purpose). Every line is
  data in `src/data/dialogue.json`, so real recordings can replace files one-for-one.
- SFX: synthesised in-house, punchy and slightly lo-fi.

## Tech

TypeScript + Three.js + Vite, runs in any modern browser (desktop keyboard/mouse first,
gamepad supported). All models are generated in code; audio is generated by
the scripts in `tools/` and committed under `public/audio/`.
