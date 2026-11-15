// Move / rotate / scale handles (three's TransformControls) driving one or many objects, with grid
// and angle snapping. The handles live in the overlay scene, so they stay crisp and un-inked.
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { LObject, V3 } from '../world/leveldata';
import { CENTRE_TYPES, SIZE_TYPES, SPAWN_ID, baseY, canScale, objHeight, r3, rotAxes } from './defs';
import type { Doc } from './state';
import type { SceneSync } from './sync';
import type { Viewport } from './viewport';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

const r5 = (v: number) => Math.round(v * 1e5) / 1e5;

interface StartState {
  pivotPos: THREE.Vector3;
  pivotQ: THREE.Quaternion;
  objs: Map<string, LObject>;
  spawn: { pos: V3; yaw: number };
}

export class Gizmo {
  readonly tc: TransformControls;
  readonly pivot = new THREE.Object3D();
  mode: GizmoMode = 'translate';
  snapOn = true;
  grid = 0.5;
  angle = 15;
  locked = new Set<string>();
  private start: StartState | null = null;
  private dragNo = 0;
  onDragEnd: (() => void)[] = [];

  constructor(
    private vp: Viewport,
    private doc: Doc,
    private sync: SceneSync,
  ) {
    this.pivot.rotation.order = 'YXZ';
    vp.overlay.add(this.pivot);
    this.tc = new TransformControls(vp.camera, vp.canvas);
    this.tc.setSize(1.05);
    vp.overlay.add(this.tc.getHelper());
    this.tc.addEventListener('change', () => vp.request());
    this.tc.addEventListener('mouseDown', () => this.begin());
    this.tc.addEventListener('objectChange', () => this.drag());
    this.tc.addEventListener('mouseUp', () => this.end());
    this.applySnap();
  }

  get dragging() {
    return this.tc.dragging;
  }
  /** pointer is over a handle (so clicks should go to the gizmo, not the scene) */
  get hot() {
    return !!this.tc.object && this.tc.axis !== null && this.tc.enabled;
  }

  /** Switch the handles off (and out of sight) while placing things or editing a patrol. */
  setEnabled(on: boolean) {
    this.tc.enabled = on;
    this.tc.getHelper().visible = on;
    this.vp.request();
  }

  setMode(m: GizmoMode) {
    this.mode = m;
    this.tc.setMode(m);
    this.refresh();
  }

  applySnap() {
    this.tc.setTranslationSnap(this.snapOn ? this.grid : null);
    this.tc.setRotationSnap(this.snapOn ? THREE.MathUtils.degToRad(this.angle) : null);
    this.tc.setScaleSnap(null);
  }

  /** ids the handles act on (locked and hidden objects are left alone) */
  targets() {
    return this.doc.selection.filter((id) => !this.locked.has(id) && !this.sync.hidden.has(id) && (id === SPAWN_ID || this.doc.get(id)));
  }

  private typeOf(id: string) {
    return id === SPAWN_ID ? SPAWN_ID : this.doc.get(id)!.type;
  }

  /** Re-place the pivot on the current selection. */
  refresh() {
    if (this.tc.dragging) return;
    const ids = this.targets();
    const active = ids[ids.length - 1];
    if (!active) {
      this.tc.detach();
      this.vp.request();
      return;
    }
    const types = ids.map((id) => this.typeOf(id));
    const single = ids.length === 1;
    let axes: 'xyz' | 'y' | 'none' = single ? rotAxes(types[0]) : types.every((t) => rotAxes(t) === 'none') ? 'none' : 'y';
    if (this.mode === 'scale' && !types.some((t) => canScale(t))) {
      this.tc.detach();
      this.vp.request();
      return;
    }
    if (this.mode === 'rotate' && axes === 'none') {
      this.tc.detach();
      this.vp.request();
      return;
    }
    this.pivot.scale.set(1, 1, 1);
    const ap = this.vp.previews.get(active);
    if (this.mode === 'rotate') {
      const box = this.sync.bounds(single ? [active] : ids);
      if (single && ap) {
        // centre of the object's own bounds
        const c = ap.bbox.getCenter(new THREE.Vector3()).applyMatrix4(ap.root.matrixWorld);
        this.pivot.position.copy(c);
      } else this.pivot.position.copy(box.getCenter(new THREE.Vector3()));
      if (single && axes === 'xyz' && ap) this.pivot.quaternion.copy(ap.root.quaternion);
      else if (single && ap) this.pivot.quaternion.copy(ap.root.quaternion);
      else this.pivot.quaternion.identity();
      this.tc.setSpace(single && axes === 'xyz' ? 'local' : 'world');
      this.tc.showX = axes === 'xyz';
      this.tc.showZ = axes === 'xyz';
      this.tc.showY = true;
    } else {
      this.pivot.position.copy(this.basePoint(active));
      if (this.mode === 'scale' && single && ap) this.pivot.quaternion.copy(ap.root.quaternion);
      else this.pivot.quaternion.identity();
      this.tc.setSpace(this.mode === 'scale' ? 'local' : 'world');
      this.tc.showX = this.tc.showY = this.tc.showZ = true;
      if (this.mode === 'scale' && single && types[0] === 'prop') {
        // props scale uniformly: only the centre handle
        this.tc.showX = this.tc.showY = this.tc.showZ = true;
      }
    }
    this.pivot.updateMatrixWorld(true);
    if (this.tc.object !== this.pivot) this.tc.attach(this.pivot);
    this.vp.request();
  }

  basePoint(id: string) {
    if (id === SPAWN_ID) return new THREE.Vector3(...this.doc.level.spawn.pos);
    const o = this.doc.get(id)!;
    return new THREE.Vector3(o.pos[0], baseY(o), o.pos[2]);
  }

  private begin() {
    const ids = this.targets();
    const objs = new Map<string, LObject>();
    for (const id of ids) if (id !== SPAWN_ID) objs.set(id, structuredClone(this.doc.get(id)!));
    this.start = {
      pivotPos: this.pivot.position.clone(),
      pivotQ: this.pivot.quaternion.clone(),
      objs,
      spawn: structuredClone(this.doc.level.spawn),
    };
    this.dragNo++;
    this.doc.breakMerge();
  }

  private drag() {
    const st = this.start;
    if (!st) return;
    const ids = this.targets();
    const label = this.mode === 'translate' ? 'Move' : this.mode === 'rotate' ? 'Rotate' : 'Scale';
    const multi = ids.length > 1;
    this.doc.edit(
      label + (multi ? ' ' + ids.length + ' objects' : ''),
      (tx) => {
        if (this.mode === 'translate') {
          const d = this.pivot.position.clone().sub(st.pivotPos);
          for (const id of ids) {
            if (id === SPAWN_ID) {
              const s = tx.settings().spawn;
              s.pos = [r3(st.spawn.pos[0] + d.x), r3(st.spawn.pos[1] + d.y), r3(st.spawn.pos[2] + d.z)];
              continue;
            }
            const s0 = st.objs.get(id)!;
            const o = tx.touch(id);
            o.pos = [r3(s0.pos[0] + d.x), r3(s0.pos[1] + d.y), r3(s0.pos[2] + d.z)];
            if (o.type === 'enemy' && s0.type === 'enemy' && s0.patrol) o.patrol = s0.patrol.map((p) => [r3(p[0] + d.x), r3(p[1] + d.y), r3(p[2] + d.z)] as V3);
          }
        } else if (this.mode === 'rotate') {
          const dq = this.pivot.quaternion.clone().multiply(st.pivotQ.clone().invert());
          const dYaw = new THREE.Euler().setFromQuaternion(dq, 'YXZ').y;
          const pv = st.pivotPos;
          for (const id of ids) {
            if (id === SPAWN_ID) {
              const s = tx.settings().spawn;
              s.yaw = r5(st.spawn.yaw + dYaw);
              const p = new THREE.Vector3(...st.spawn.pos).sub(pv).applyQuaternion(dq).add(pv);
              if (multi) s.pos = [r3(p.x), r3(st.spawn.pos[1]), r3(p.z)];
              continue;
            }
            const s0 = st.objs.get(id)!;
            const o = tx.touch(id);
            const axes = rotAxes(o.type);
            if (axes === 'none') continue;
            const r0 = s0.rot ?? [0, 0, 0];
            if (axes === 'xyz' && !multi) {
              const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(r0[0], r0[1], r0[2], 'YXZ'));
              const e = new THREE.Euler().setFromQuaternion(dq.clone().multiply(q0), 'YXZ');
              o.rot = [r5(e.x), r5(e.y), r5(e.z)];
            } else {
              o.rot = [r0[0], r5(r0[1] + dYaw), r0[2]];
            }
            if (o.rot.every((v) => v === 0)) delete o.rot;
            // swing the position around the pivot
            const p0 = new THREE.Vector3(...s0.pos);
            const p = p0.clone().sub(pv).applyQuaternion(dq).add(pv);
            if (multi || axes === 'xyz') o.pos = [r3(p.x), r3(multi ? p0.y : p.y), r3(p.z)];
          }
        } else {
          const sc = this.pivot.scale;
          const f: V3 = [Math.abs(sc.x), Math.abs(sc.y), Math.abs(sc.z)];
          const uni = [f[0], f[1], f[2]].reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a), 1);
          const step = this.snapOn ? this.grid : 0;
          const snapLen = (v: number) => Math.max(step || 0.05, step ? Math.round(v / step) * step : r3(v));
          for (const id of ids) {
            if (id === SPAWN_ID) continue;
            const s0 = st.objs.get(id)!;
            const o = tx.touch(id);
            if (SIZE_TYPES.has(o.type) && 'size' in o && 'size' in s0) {
              const base0 = baseY(s0);
              o.size = [snapLen(s0.size[0] * f[0]), snapLen(s0.size[1] * f[1]), snapLen(s0.size[2] * f[2])];
              if (CENTRE_TYPES.has(o.type)) o.pos = [o.pos[0], r3(base0 + o.size[1] / 2), o.pos[2]];
            } else if (o.type === 'prop' && s0.type === 'prop') {
              const v = (s0.scale ?? 1) * uni;
              o.scale = Math.max(0.1, this.snapOn ? Math.round(v * 20) / 20 : r3(v));
              if (o.scale === 1) delete o.scale;
            } else if (o.type === 'cyl' && s0.type === 'cyl') {
              const fr = Math.abs(f[0] - 1) > Math.abs(f[2] - 1) ? f[0] : f[2];
              o.r = Math.max(0.05, step ? Math.max(step / 2, Math.round((s0.r * fr) / (step / 2)) * (step / 2)) : r3(s0.r * fr));
              o.h = snapLen(s0.h * f[1]);
            }
          }
        }
      },
      { merge: 'drag:' + this.dragNo },
    );
  }

  private end() {
    this.start = null;
    this.doc.breakMerge();
    // the pivot's scale is a drag-only thing
    this.pivot.scale.set(1, 1, 1);
    setTimeout(() => this.refresh(), 0);
    for (const f of this.onDragEnd) f();
  }
}

export { objHeight };
