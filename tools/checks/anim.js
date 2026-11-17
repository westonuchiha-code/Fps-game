// url: ?level=test
// Authored clips (public/anims/clips.json) load and play: a worker's reload moves the rifle and the
// left hand, then ends and hands back to the procedural motion.
game.manual = true;
game.step(30, 1 / 60);
const ai = game.ai, pl = game.player;
const log = [];
let pass = true;
const expect = (cond, msg) => { log.push((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) pass = false; };
const n = ai.spawnAlly('rivet', pl.pos.clone().set(pl.pos.x + 3, 0, pl.pos.z), {});
game.step(20, 1 / 60);
const g = n.model.held;
expect(!!g, 'worker carries a rifle');
const fore = n.model.bones[5];
const q0 = g.quaternion.clone();
const h0 = fore.quaternion.clone();
const played = n.anim.play('reload');
expect(played, 'reload clip found and played on a worker');
game.step(36, 1 / 60);
const turned = (q0.angleTo(g.quaternion) * 180) / Math.PI;
const hand = (h0.angleTo(fore.quaternion) * 180) / Math.PI;
expect(turned > 15, `rifle tilts during the reload (${turned.toFixed(0)}°)`);
expect(hand > 10, `left forearm moves to the magazine (${hand.toFixed(0)}°)`);
game.step(150, 1 / 60);
expect(!n.anim.playing, 'clip ends by itself');
const robot = ai.spawnEnemy('assoc', pl.pos.clone().set(pl.pos.x - 3, 0, pl.pos.z + 6), {});
expect(!robot.anim.play('reload'), 'a clip only plays on the characters it is for');
return { pass, log };
