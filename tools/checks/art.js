// url: ?level=test
// Surface recipes and decals load: models carry per-part surfaces, workers wear their decals.
game.manual = true;
game.step(10, 1 / 60);
const art = game.debug.art, ai = game.ai, pl = game.player;
const log = [];
let pass = true;
const expect = (cond, msg) => { log.push((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) pass = false; };
const names = Object.keys(art.SURFACES);
expect(names.length >= 20, `surface recipes loaded (${names.length})`);
expect(names.includes('denim') && names.includes('concrete'), 'model and world recipes both present');
const n = ai.spawnAlly('rivet', pl.pos.clone().set(pl.pos.x + 3, 0, pl.pos.z), {});
const sid = n.model.mesh.geometry.getAttribute('surf');
const used = new Set();
for (let i = 0; i < sid.count; i++) used.add(sid.getX(i));
expect(used.size >= 6, `a worker is built from several surfaces (${used.size})`);
expect(used.has(art.surfaceSlot('denim')) && used.has(art.surfaceSlot('hivis')), 'denim trousers and a hi-vis vest');
let decals = 0;
n.model.root.traverse((o) => { if (o.userData && o.userData.decal) decals++; });
expect(decals === (art.PLACEMENTS.striker?.length ?? 0) && decals > 0, `worker wears its decals (${decals})`);
return { pass, log };
