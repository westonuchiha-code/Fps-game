// Keeps the scene in step with the document: one preview per object (rebuilt only when its look
// changes), patrol routes, selection / hover outlines, hidden + locked state.
import * as THREE from 'three';
import type { LObject, V3 } from '../world/leveldata';
import { LAYER_FX } from '../render/pipeline';
import { flat } from '../render/toon';
import type { Doc, ChangeEvent } from './state';
import { SPAWN_ID, enemyInfo } from './defs';
import { Preview, applyLabel, applyTransform, buildBody, buildSpawnPreview, lineMat, shapeKey } from './previews';
import type { Viewport } from './viewport';
import { hexToNum } from '../world/leveldata';
import { GeoBuilder } from '../world/builder';
import { emitShape, isShape } from '../world/shapes';
import { PROPS } from '../world/props';

/** Static objects are merged into chunks of this size (metres) to keep draw calls low. */
const BAKE_CELL = 32;
interface Chunk {
  members: Set<string>;
  group: THREE.Group | null;
  dirty: boolean;
}

const EDGE_IDX = [0, 1, 1, 3, 3, 2, 2, 0, 4, 5, 5, 7, 7, 6, 6, 4, 0, 4, 1, 5, 2, 6, 3, 7];
function boxLines(color: number, opacity: number) {
  const g = new THREE.BufferGeometry();
  const pts: number[] = [];
  for (const i of EDGE_IDX) pts.push(i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const l = new THREE.LineSegments(g, lineMat(color, opacity, false));
  l.renderOrder = 10;
  l.frustumCulled = false;
  return l;
}

export class SceneSync {
  readonly spawn = new Preview(SPAWN_ID);
  hidden = new Set<string>();
  private patrolLines = new Map<string, THREE.Object3D>();
  private outlines: THREE.LineSegments[] = [];
  private hoverLine = boxLines(0xffffff, 0.55);
  hoverId: string | null = null;
  /** patrol handle currently being edited (enemy id) */
  patrolEdit: string | null = null;
  private handleGeo = new THREE.SphereGeometry(0.22, 10, 8);
  // ---- baking: unselected static shapes are drawn from merged per-chunk meshes; each object's
  // own preview stays in the scene (invisible) for picking, and reappears the moment it is touched.
  private chunks = new Map<string, Chunk>();
  private chunkOf = new Map<string, string>();
  private bakeTimer = 0;
  private lastSel = new Set<string>();
  bakeEnabled = true;

  constructor(
    private doc: Doc,
    private vp: Viewport,
  ) {
    buildSpawnPreview(this.spawn);
    vp.content.add(this.spawn.root);
    vp.previews.set(SPAWN_ID, this.spawn);
    this.hoverLine.visible = false;
    vp.overlay.add(this.hoverLine);
    doc.onChange((e) => this.onChange(e));
    doc.onSelect(() => {
      const now = new Set(doc.selection);
      for (const id of now) if (!this.lastSel.has(id)) this.touchBake(id);
      for (const id of this.lastSel) if (!now.has(id)) this.touchBake(id);
      this.lastSel = now;
      this.updateSelection();
    });
    this.rebuildAll();
  }

  rebuildAll() {
    for (const [id, p] of this.vp.previews) {
      if (id === SPAWN_ID) continue;
      p.dispose();
      this.vp.previews.delete(id);
    }
    for (const l of this.patrolLines.values()) l.removeFromParent();
    this.patrolLines.clear();
    for (const c of this.chunks.values()) this.dropChunkMesh(c);
    this.chunks.clear();
    this.chunkOf.clear();
    this.lastSel = new Set(this.doc.selection);
    for (const o of this.doc.level.objects) this.update(o.id);
    this.bake();
    this.updateSpawn();
    this.updateSelection();
    this.vp.request();
  }

  private onChange(e: ChangeEvent) {
    if (e.source === 'load') {
      this.hidden.clear();
      this.rebuildAll();
      return;
    }
    for (const id of e.ids) this.update(id);
    if (e.settings) this.updateSpawn();
    // labels of others can depend on names/tags; cheap to refresh
    if (e.ids.size < 50) for (const o of this.doc.level.objects) if (!e.ids.has(o.id)) this.relabel(o);
    this.updateSelection();
    this.vp.request();
  }

  private relabel(o: LObject) {
    const p = this.vp.previews.get(o.id);
    if (p) applyLabel(p, o, this.doc.level);
  }

  /** Bring one object's preview up to date (create, rebuild, move or delete it). */
  update(id: string) {
    const o = this.doc.get(id);
    let p = this.vp.previews.get(id);
    if (!o) {
      if (p) {
        p.dispose();
        this.vp.previews.delete(id);
      }
      this.updatePatrol(id, null);
      this.touchBake(id);
      return;
    }
    if (!p) {
      p = new Preview(id);
      this.vp.previews.set(id, p);
      this.vp.content.add(p.root);
    }
    applyTransform(p, o);
    if (p.key !== shapeKey(o)) buildBody(p, o);
    applyLabel(p, o, this.doc.level);
    p.hidden = this.hidden.has(id);
    p.root.visible = !p.hidden;
    this.updatePatrol(id, o);
    this.touchBake(id);
  }

  // ---- baking ----

  private cellKey(o: LObject) {
    return Math.floor(o.pos[0] / BAKE_CELL) + ',' + Math.floor(o.pos[2] / BAKE_CELL);
  }
  private bakeable(o: LObject) {
    return this.bakeEnabled && isShape(o) && !this.hidden.has(o.id) && !this.doc.isSelected(o.id) && (o.type !== 'prop' || !!PROPS[o.prop]);
  }
  private dropChunkMesh(c: Chunk) {
    if (!c.group) return;
    c.group.traverse((m) => (m as THREE.Mesh).geometry?.dispose());
    c.group.removeFromParent();
    c.group = null;
  }
  /** The chunk is out of date: stop drawing it merged and show its members one by one until it is re-baked. */
  private invalidate(key: string | undefined) {
    const c = key ? this.chunks.get(key) : undefined;
    if (!c || c.dirty) return;
    c.dirty = true;
    this.dropChunkMesh(c);
    for (const id of c.members) {
      const p = this.vp.previews.get(id);
      if (p) p.body.visible = true;
    }
  }
  /** Something about this object changed: take it out of its merged chunk (and file it under the right one). */
  touchBake(id: string) {
    if (id === SPAWN_ID) return;
    const old = this.chunkOf.get(id);
    this.invalidate(old);
    const o = this.doc.get(id);
    if (o && isShape(o)) {
      const k = this.cellKey(o);
      if (old && old !== k) this.chunks.get(old)?.members.delete(id);
      let c = this.chunks.get(k);
      if (!c) this.chunks.set(k, (c = { members: new Set(), group: null, dirty: true }));
      c.members.add(id);
      this.chunkOf.set(id, k);
      this.invalidate(k);
    } else if (old) {
      this.chunks.get(old)?.members.delete(id);
      this.chunkOf.delete(id);
    }
    clearTimeout(this.bakeTimer);
    this.bakeTimer = window.setTimeout(() => this.bake(), 600);
  }
  /** Merge every out-of-date chunk. */
  bake() {
    clearTimeout(this.bakeTimer);
    for (const c of this.chunks.values()) {
      if (!c.dirty) continue;
      c.dirty = false;
      const ids: string[] = [];
      for (const id of c.members) {
        const o = this.doc.get(id);
        if (o && this.bakeable(o)) ids.push(id);
      }
      if (ids.length < 2) continue;
      const b = new GeoBuilder();
      for (const id of ids) emitShape(b, this.doc.get(id)!);
      const built = b.build();
      built.collision.dispose();
      built.group.traverse((m) => (m.userData.baked = true));
      c.group = built.group;
      this.vp.content.add(c.group);
      for (const id of ids) {
        const p = this.vp.previews.get(id);
        if (p) p.body.visible = false;
      }
    }
    this.vp.request();
  }
  bakeStats() {
    let chunks = 0;
    let baked = 0;
    for (const c of this.chunks.values())
      if (c.group) {
        chunks++;
        for (const id of c.members) if (this.vp.previews.get(id)?.body.visible === false) baked++;
      }
    return { chunks, baked };
  }

  updateSpawn() {
    const s = this.doc.level.spawn;
    this.spawn.root.position.set(s.pos[0], s.pos[1], s.pos[2]);
    this.spawn.root.rotation.set(0, s.yaw, 0, 'YXZ');
    this.spawn.root.updateMatrixWorld(true);
    this.spawn.hidden = this.hidden.has(SPAWN_ID);
    this.spawn.root.visible = !this.spawn.hidden;
  }

  setHidden(id: string, hidden: boolean) {
    if (hidden) this.hidden.add(id);
    else this.hidden.delete(id);
    if (id === SPAWN_ID) this.updateSpawn();
    else this.update(id);
    this.updateSelection();
    this.vp.request();
  }

  private updatePatrol(id: string, o: LObject | null) {
    const old = this.patrolLines.get(id);
    if (old) {
      old.traverse((c) => {
        const g = (c as THREE.Mesh).geometry;
        if (g && g !== this.handleGeo) g.dispose();
      });
      old.removeFromParent();
      this.patrolLines.delete(id);
    }
    if (!o || o.type !== 'enemy' || !o.patrol?.length || this.hidden.has(id)) return;
    const col = hexToNum(enemyInfo(o.kind).color);
    const grp = new THREE.Group();
    const lift = (p: V3) => new THREE.Vector3(p[0], p[1] + 0.15, p[2]);
    const pts = [lift(o.pos), ...o.patrol.map(lift)];
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(col, 0.95));
    grp.add(line);
    if (o.patrol.length > 1) {
      const back = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([pts[pts.length - 1], pts[1]]), lineMat(col, 0.35));
      grp.add(back);
    }
    const editing = this.patrolEdit === id;
    o.patrol.forEach((p, i) => {
      const m = new THREE.Mesh(this.handleGeo, flat(editing ? 0xffffff : col, { fog: false }));
      m.position.copy(lift(p));
      m.scale.setScalar(editing ? 1.2 : 0.7);
      m.userData.patrolIndex = i;
      grp.add(m);
    });
    grp.traverse((c) => {
      c.layers.set(LAYER_FX);
      c.raycast = () => {};
    });
    this.vp.scene.add(grp);
    this.patrolLines.set(id, grp);
  }

  refreshPatrol(id: string) {
    this.updatePatrol(id, this.doc.get(id) ?? null);
    this.vp.request();
  }

  /** Patrol point handle under a screen position (within 14 px). */
  patrolHandleAt(cx: number, cy: number): { id: string; index: number } | null {
    const id = this.patrolEdit;
    if (!id) return null;
    const o = this.doc.get(id);
    if (!o || o.type !== 'enemy' || !o.patrol) return null;
    let best: { id: string; index: number } | null = null;
    let bd = 14;
    o.patrol.forEach((p, i) => {
      const s = this.vp.toScreen(new THREE.Vector3(p[0], p[1] + 0.15, p[2]));
      if (!s) return;
      const d = Math.hypot(s.x - cx, s.y - cy);
      if (d < bd) {
        bd = d;
        best = { id, index: i };
      }
    });
    return best;
  }

  updateSelection() {
    const sel = this.doc.selection;
    for (const p of this.vp.previews.values()) p.root.userData.selected = false;
    while (this.outlines.length < sel.length) {
      const l = boxLines(0xffd21f, 1);
      this.vp.overlay.add(l);
      this.outlines.push(l);
    }
    this.outlines.forEach((l, i) => {
      const p = i < sel.length ? this.vp.previews.get(sel[i]) : undefined;
      l.visible = !!p && !p.hidden;
      if (p) {
        p.root.userData.selected = true;
        this.fitLines(l, p);
        (l.material as THREE.LineBasicMaterial) = lineMat(i === sel.length - 1 ? 0xffd21f : 0xffa020, 1, false);
      }
    });
    const hp = this.hoverId && !sel.includes(this.hoverId) ? this.vp.previews.get(this.hoverId) : undefined;
    this.hoverLine.visible = !!hp && !hp.hidden;
    if (hp) this.fitLines(this.hoverLine, hp);
    this.vp.request();
  }

  private fitLines(l: THREE.LineSegments, p: Preview) {
    const b = p.bbox;
    const size = b.getSize(new THREE.Vector3()).addScalar(0.06);
    const c = b.getCenter(new THREE.Vector3());
    p.root.updateMatrixWorld(true);
    const m = new THREE.Matrix4().compose(c, new THREE.Quaternion(), size);
    l.matrixAutoUpdate = false;
    l.matrix.multiplyMatrices(p.root.matrixWorld, m);
    l.matrixWorld.copy(l.matrix);
    l.matrixWorldNeedsUpdate = true;
  }

  setHover(id: string | null) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.updateSelection();
  }

  /** World-space bounds of a set of objects. */
  bounds(ids: string[]) {
    const box = new THREE.Box3();
    for (const id of ids) {
      const p = this.vp.previews.get(id);
      if (!p) continue;
      p.root.updateMatrixWorld(true);
      box.union(p.bbox.clone().applyMatrix4(p.root.matrixWorld));
    }
    return box;
  }
}
