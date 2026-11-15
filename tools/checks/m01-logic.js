// url: ?level=m01&nointro=1
// Mission 01's scripted beats: gate couplings, vehicles, boss phases, ending.
game.manual = true;
const d = game.debug, pl = game.player, ai = game.ai, lvl = game.level;
const log = [];
let pass = true;
const expect = (cond, msg) => { log.push((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) pass = false; };
const V = (x, y, z) => pl.pos.clone().set(x, y, z);
const yieldNow = () => new Promise((r) => setTimeout(r, 0));
const objs = () => lvl.objectives.map((o) => o.id + (o.done ? '✓' : '')).join(',');
let done = false;
game.events.on('missionComplete', () => { done = true; });
pl.godMode = true;
game.step(30, 1 / 60);
expect(!!game.inv.current && ai.allies.length === 3 && ai.aliveEnemies() > 20, `starts armed with a squad (${ai.allies.length} allies, ${ai.aliveEnemies()} enemies)`);
expect(game.vehicles.list.length === 3, 'three vehicles parked in the motor pool');

d.tp(0, 0.1, -36, 0, 0);
game.step(30, 1 / 60);
d.tp(0, 0.1, -44, 0, 0);
game.step(400, 1 / 60);
await yieldNow();
expect(lvl.objectives.some((o) => o.id === 'gate'), 'reaching the gate gives the couplings objective');
game.world.explode(V(-7.6, 0.8, -52.6), 4, 300, pl);
game.step(60, 1 / 60);
expect(lvl.counter('couplings') === 1 && !lvl.isDone('gate'), 'one coupling is not enough');
game.world.explode(V(7.6, 0.8, -52.6), 4, 300, pl);
game.step(120, 1 / 60);
expect(lvl.isDone('gate') && lvl.isDone('docks'), 'both couplings open the gate: ' + objs());
d.tp(0, 0.1, -50, 0, 0);
d.run(150, { move: [0, 1] });
expect(pl.pos.z < -57, `can walk through where the gate was (z=${pl.pos.z.toFixed(1)})`);

d.tp(0, 0.1, -432, 0, 0);
d.run(60, { move: [0, 1] });
game.step(300, 1 / 60);
await yieldNow();
const boss = ai.npcs.find((n) => n.def.kind === 'manager');
expect(!!boss && lvl.objectives.some((o) => o.id === 'boss'), 'entering the forecourt wakes the Regional Manager');
const before = ai.aliveEnemies();
boss.takeDamage({ amount: boss.maxHealth * 0.55, element: 'none', crit: false, kind: 'bullet', source: pl, point: boss.pos.clone(), dir: V(0, 0, -1), zone: 'weak' });
game.step(60, 1 / 60);
expect(boss.brain.enraged && ai.aliveEnemies() > before, 'at half health it enrages and calls reinforcements');
for (let k = 0; k < 3; k++) {
  for (const n of ai.npcs.slice()) if (n.alive && n.faction === 'monomart') n.takeDamage({ amount: 999999, element: 'none', crit: false, kind: 'bullet', source: pl, point: n.pos.clone(), dir: V(0, 0, -1), zone: 'weak' });
  for (const dr of ai.drones.slice()) if (dr.alive) dr.takeDamage({ amount: 9999, element: 'none', crit: false, kind: 'bullet', source: pl, point: dr.pos.clone(), dir: V(0, 0, -1) });
  game.step(30, 1 / 60);
  await yieldNow();
}
let t = 0;
while (t < 80 && !done) { game.step(30, 1 / 60); t += 0.5; await yieldNow(); }
expect(done, `ending cutscene plays and the mission completes (${t}s after the last kill)`);
return { pass, log };
