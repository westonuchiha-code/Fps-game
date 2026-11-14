import * as THREE from 'three';
import type { Game } from '../game';
import { rollWeapon, type Brand, type Rarity, type WeaponClass } from '../weapons/items';
import type { ClipName } from '../weapons/clips';
import { setLayer } from '../render/kit';
import { LAYER_VIEW, LAYER_WORLD } from '../render/pipeline';

/** Developer helpers used by the screenshot tooling. Loaded only with ?dev in the URL. */
export function installDebug(game: Game) {
  const anchor = new THREE.Object3D();
  const d = {
    /** Give + equip a specific roll. */
    gun(cls: WeaponClass, brand?: Brand, rarity: Rarity = 2, seed = 7, slot = 0) {
      const item = rollWeapon(3, { cls, brand, rarity, seed });
      game.inv.slots[slot] = item;
      game.inv.active = slot;
      game.weapons.equipActive();
      return item;
    },
    /** Jump the current clip to a time and settle the fingers. */
    pose(clip: ClipName, t: number) {
      const v = game.view;
      v.play(clip, 0, 1, 0);
      v.anim.speed = 0;
      v.anim.time = t;
      v.anim.apply();
      for (let i = 0; i < 30; i++) {
        v.left.pose = v.anim.left!.pose;
        v.right.pose = v.anim.right!.pose;
        v.left.update(0.05);
        v.right.update(0.05);
      }
    },
    /**
     * Look at the first-person rig from outside. `cam`/`look` are in the rig's own space
     * (x right, y up, -z forward from the player's eye).
     */
    rigView(cam: [number, number, number], look: [number, number, number] = [0.1, -0.12, -0.35], fov = 40) {
      anchor.position.set(0, 60, 0);
      anchor.quaternion.identity();
      game.view.debugAnchor = anchor;
      setLayer(game.view.root, LAYER_WORLD);
      game.view.root.visible = true;
      game.cameraOwner = {
        updateCamera(c) {
          c.position.set(cam[0], 60 + cam[1], cam[2]);
          c.up.set(0, 1, 0);
          c.lookAt(look[0], 60 + look[1], look[2]);
          c.fov = fov;
          c.near = 0.02;
          c.updateProjectionMatrix();
        },
      };
      game.hud.setVisible(false);
    },
    rigViewOff() {
      game.view.debugAnchor = null;
      setLayer(game.view.root, LAYER_VIEW);
      game.cameraOwner = null;
      game.hud.setVisible(true);
      game.camera.near = 0.08;
    },
    tp(x: number, y: number, z: number, yaw?: number, pitch?: number) {
      game.player.pos.set(x, y, z);
      game.player.vel.set(0, 0, 0);
      if (yaw !== undefined) game.player.yaw = yaw;
      if (pitch !== undefined) game.player.pitch = pitch;
    },
    /** hold actions / move for n frames */
    run(frames: number, o: { move?: [number, number]; look?: [number, number]; down?: string[] } = {}) {
      const inp = game.input;
      inp.simMove.x = o.move?.[0] ?? 0;
      inp.simMove.y = o.move?.[1] ?? 0;
      inp.simDown.clear();
      for (const a of o.down ?? []) inp.simDown.add(a as any);
      for (let i = 0; i < frames; i++) {
        if (o.look) {
          inp.simLook.x = o.look[0];
          inp.simLook.y = o.look[1];
        }
        game.tick(1 / 60);
      }
      inp.simMove.x = inp.simMove.y = 0;
      inp.simDown.clear();
      game.render();
    },
  };
  (game as any).debug = d;
  return d;
}
