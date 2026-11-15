import * as THREE from 'three';
import { G } from '../core/globals';
import { CharAnim, CharModel, PALETTES } from '../ai/charModel';
import { Cutscene } from '../story/cutscene';
import { rollWeapon } from '../weapons/items';
import { SCRIPTS, type JsonLevel } from '../world/jsonLevel';

/**
 * Mission 01 "Receiving" - everything the level file cannot express on its own:
 * the opening cutscene, the gate set-piece, the Regional Manager fight and the ending.
 * The layout, enemies, triggers and most radio chatter live in public/levels/m01.json.
 */

interface State {
  time: number;
  gateDone: boolean;
  resupplyT: number;
  inVehicle: boolean;
  drove: boolean;
  bossOn: boolean;
  bossHintT: number;
  ended: boolean;
  idleT: number;
  lastZ: number;
  dummy: { model: CharModel; anim: CharAnim } | null;
}
let st: State;

const fresh = (): State => ({ time: 0, gateDone: false, resupplyT: 0, inVehicle: false, drove: false, bossOn: false, bossHintT: -1, ended: false, idleT: 0, lastZ: 0, dummy: null });

/** A stand-in body for the player in third-person shots. */
function showAgent(pos: THREE.Vector3, yaw: number) {
  hideAgent();
  const model = new CharModel('striker', PALETTES.striker, 99);
  model.root.position.copy(pos);
  model.root.rotation.y = yaw;
  G.scene.add(model.root);
  st.dummy = { model, anim: new CharAnim(model) };
}
function hideAgent() {
  st?.dummy?.model.dispose();
  if (st) st.dummy = null;
}

async function intro(lvl: JsonLevel) {
  const pl = G.player;
  const cs = new Cutscene();
  showAgent(pl.pos, pl.yaw);
  void G.audio.playMusic(null);
  await G.hud.fade(true, 0.01);
  await cs.run(async (c) => {
    c.shot({ from: [-36, 30, 132], to: [-14, 15, 124], look: [0, 3, 62], lookTo: [0, 2, 30], fov: 58, dur: 9, ease: 'inOut' });
    void G.hud.fade(false, 1.6);
    void G.audio.stinger('start');
    G.hud.typed('RUSTBELT FLATS\nMONOMART FULFILLMENT CENTER 7\n05:47', 3.2);
    await c.wait(1.2);
    G.audio.play('pa_chime', { vol: 0.8, bus: 'ui' });
    await c.wait(1.3);
    await c.say('m01_intro_pa', 0.5);

    void G.audio.playMusic('m01');
    c.shot({ from: [10, 2.3, 108.5], to: [6.5, 1.9, 110], look: [0, 1.4, 114.5], fov: 46, dur: 7 });
    await c.say('m01_intro_s1');

    c.shot({ from: [-18, 13, -28], to: [-7, 7.5, -41], look: [0, 2.5, -55], fov: 52, dur: 5.5 });
    await c.say('m01_intro_s2', 0.4);

    c.shot({ from: [-1.7, 1.72, 111.5], to: [-1.9, 1.7, 111.9], look: [-3.2, 1.62, 113.6], fov: 34, dur: 6 });
    await c.say('m01_intro_rivet', 0.35);

    c.shot({ from: [-8, 2.8, 108], to: [8, 2.2, 107.4], look: [0, 1.3, 114.6], fov: 48, dur: 9, ease: 'linear' });
    await c.say('m01_intro_s3', 0.3);

    c.shot({ from: [4.9, 1.76, 112.3], to: [4.6, 1.74, 112.7], look: [3.4, 1.66, 114.4], fov: 34, dur: 5 });
    await c.say('m01_intro_dutch', 0.3);

    c.shot({ from: [0, 2.6, 119.5], to: [0, 1.72, 112.4], look: [0, 1.5, 96], fov: 56, fovTo: 70, dur: 4.2, ease: 'inOut' });
    await c.say('m01_intro_s4', 0.2);
    G.hud.titleCard(lvl.number, lvl.title.toUpperCase(), 3.6);
    await c.wait(0.9);
  });
  hideAgent();
  lvl.begin();
  void G.audio.say('m01_start');
}

async function ending(lvl: JsonLevel) {
  if (st.ended) return;
  st.ended = true;
  G.hud.setBoss(null);
  lvl.complete('boss');
  void G.audio.playMusic('m01');
  void G.audio.say('m01_manager_dead');
  await new Promise<void>((r) => lvl.after(4.2, r));
  if (lvl.disposed) return;
  const pl = G.player;
  if (pl.vehicle) pl.vehicle.exit();
  const cs = new Cutscene();
  cs.skippable = false;
  showAgent(pl.pos, Math.atan2(-(0 - pl.pos.x), -(-522 - pl.pos.z)));
  await cs.run(async (c) => {
    c.shot({ from: [14, 5, -486], to: [5, 3.2, -498], look: [0, 3.5, -522], fov: 52, dur: 6 });
    await c.wait(1.0);
    lvl.removeObject('fcdoor', true);
    await c.wait(1.6);
    await c.say('m01_end_s', 0.4);
    c.shot({ from: [0, 16, -500], to: [0, 20, -494], look: [0, 12, -523], fov: 40, dur: 7 });
    await c.say('m01_end_price', 0.6);
    void G.audio.stinger('complete');
    await G.hud.fade(true, 1.2);
  });
  hideAgent();
  lvl.finish();
}

SCRIPTS.m01 = {
  onStart(lvl) {
    st = fresh();
    // starter kit: a house-brand pistol and three charges
    const inv = G.inv;
    inv.reset();
    inv.give(rollWeapon(1, { cls: 'pistol', brand: 'valu', rarity: 0, seed: 1 }));
    inv.ammo.pistol = 60;
    inv.mines = 3;
    G.player.setShield(0, 3, 0);
    G.audio.preloadVoice(['m01_intro_pa', 'm01_intro_s1', 'm01_intro_s2', 'm01_intro_rivet', 'm01_intro_s3', 'm01_intro_dutch', 'm01_intro_s4', 'm01_start', 'm01_first_contact']);
    G.audio.preloadBarks(['assoc', 'super', 'manager', 'rivet', 'dutch', 'hank']);
    const skip = new URLSearchParams(location.search).has('nointro');
    if (skip) {
      lvl.begin();
      return true;
    }
    void intro(lvl);
    return true;
  },

  onUpdate(lvl, dt) {
    st.time += dt;
    const pl = G.player;
    if (st.dummy) st.dummy.anim.update(dt);

    // never leave the player unable to open the gate
    if (!st.gateDone && lvl.objectives.some((o) => o.id === 'gate')) {
      st.resupplyT -= dt;
      if (G.inv.mines === 0 && G.mines.armedCount === 0 && st.resupplyT <= 0) {
        st.resupplyT = 14;
        const m = lvl.marker('mine_cache');
        if (m) {
          G.loot.spawn('mine', m.pos, { amount: 2 });
          void G.audio.say('st_mines_out');
        }
      }
    }

    // vehicle chatter
    const inV = !!pl.vehicle;
    if (inV && !st.inVehicle && !st.drove) {
      st.drove = true;
      lvl.after(1.2, () => void G.audio.say('m01_gunner'));
      lvl.after(4.2, () => void G.audio.say('m01_drive_go'));
      if (!lvl.isDone('drive') && G.audio.hasMusic('drive')) void G.audio.playMusic('drive');
    }
    st.inVehicle = inV;

    // boss coaching
    if (st.bossOn && st.bossHintT > 0) {
      st.bossHintT -= dt;
      if (st.bossHintT <= 0) void G.audio.say('m01_manager_hint');
    }

    // a nudge if the player is sightseeing
    if (Math.abs(pl.pos.z - st.lastZ) > 6 || G.ai.inCombat || pl.frozen) {
      st.lastZ = pl.pos.z;
      st.idleT = 0;
    } else {
      st.idleT += dt;
      if (st.idleT > 75) {
        st.idleT = 0;
        void G.audio.say(Math.random() < 0.5 ? 'st_idle_1' : 'st_idle_2');
      }
    }
  },

  hooks: {
    gate_blown(lvl) {
      st.gateDone = true;
      lvl.removeObject('dockgate', true);
      lvl.complete('gate');
      lvl.complete('docks');
      lvl.spawnTag('pool');
      lvl.checkpoint([0, 0.1, -46], 0, true);
      G.ai.allies.forEach((a) => a.bark('boom', 0, true));
      lvl.after(1.4, () => void G.audio.say('m01_gate_blown'));
      lvl.after(4.4, () => void G.audio.say('m01_gate_blown_s'));
    },
    boss_intro(lvl) {
      if (st.bossOn) return;
      st.bossOn = true;
      st.bossHintT = 20;
      lvl.spawnTag('boss');
      if (G.audio.hasMusic('boss')) void G.audio.playMusic('boss');
      G.audio.setMusicIntensity(1);
      void G.audio.say('m01_arena_1');
      lvl.after(4.4, () => void G.audio.say('m01_manager_intro'));
      lvl.objective('boss', 'Terminate the Regional Manager');
    },
    ending(lvl) {
      void ending(lvl);
    },
  },
};

G_onceEvents();

/** Game-wide listeners that only matter while this mission is loaded. */
function G_onceEvents() {
  // registered lazily: G does not exist yet while modules are being evaluated
  queueMicrotask(function attach() {
    if (!G) {
      setTimeout(attach, 50);
      return;
    }
    G.events.on('managerHalf', () => {
      const lvl = G.level as JsonLevel | null;
      if (!lvl || lvl.id !== 'm01') return;
      lvl.spawnTag('boss_adds');
      void G.audio.say('m01_manager_half');
    });
    G.events.on('levelUnload', () => hideAgent());
  });
}
