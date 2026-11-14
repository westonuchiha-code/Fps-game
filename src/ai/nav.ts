import * as THREE from 'three';
import { G } from '../core/globals';

/**
 * Layered grid navigation.
 *
 * The level is sampled on a regular XZ grid; every cell can hold several walkable nodes at
 * different heights (ground, container tops, upper decks). Neighbouring nodes whose heights are
 * within a step are linked, giving a graph that follows ramps and stairs without any authoring.
 * Nodes that sit next to something solid at crouch height are remembered as cover.
 */

export const CELL = 0.8;
const STEP = 0.62; // max height difference between linked neighbours
const AGENT_R = 0.34;
const AGENT_H = 1.7;
const MAX_LAYERS = 4;

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const DCOST = [1, 1, 1, 1, 1.4142, 1.4142, 1.4142, 1.4142];

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

export interface CoverSpot {
  node: number;
  /** unit direction (xz) from the node towards the thing giving cover */
  dx: number;
  dz: number;
  /** true when you can shoot over it standing up */
  low: boolean;
}

export class Nav {
  count = 0;
  x = new Float32Array(0);
  y = new Float32Array(0);
  z = new Float32Array(0);
  /** 8 neighbour node indices per node, -1 where blocked */
  nb = new Int32Array(0);
  /** distance in cells to the nearest edge of walkable space (capped) */
  clear = new Uint8Array(0);
  covers: CoverSpot[] = [];
  private coverGrid = new Map<number, number[]>();
  private cells = new Map<number, number[]>();
  /** nodes currently reserved by an agent (cover spots, destinations) */
  private claimed = new Map<number, number>();
  // A* scratch
  private g = new Float32Array(0);
  private f = new Float32Array(0);
  private from = new Int32Array(0);
  private mark = new Uint32Array(0);
  private stamp = 1;
  private heap: number[] = [];

  private key(ix: number, iz: number) {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  clearAll() {
    this.count = 0;
    this.cells.clear();
    this.covers = [];
    this.coverGrid.clear();
    this.claimed.clear();
  }

  /** Sample the level inside each box and build the graph. Call after the collision world is ready. */
  build(areas: THREE.Box3[]) {
    const t0 = performance.now();
    this.clearAll();
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    for (const box of areas) {
      const ix0 = Math.floor(box.min.x / CELL);
      const ix1 = Math.ceil(box.max.x / CELL);
      const iz0 = Math.floor(box.min.z / CELL);
      const iz1 = Math.ceil(box.max.z / CELL);
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const k = this.key(ix, iz);
          const wx = (ix + 0.5) * CELL;
          const wz = (iz + 0.5) * CELL;
          let list = this.cells.get(k);
          let top = box.max.y;
          for (let layer = 0; layer < MAX_LAYERS && top > box.min.y; layer++) {
            const hit = G.col.raycast(_o.set(wx, top, wz), DOWN, top - box.min.y + 0.01, 'static');
            if (!hit) break;
            top = hit.point.y - 0.35;
            if (hit.normal.y < 0.7) continue;
            const ny = hit.point.y;
            if (list && list.some((n) => Math.abs(ys[n] - ny) < 0.5)) continue;
            if (!G.col.capsuleFree(_p.set(wx, ny + 0.12, wz), AGENT_R, AGENT_H)) continue;
            const id = xs.length;
            xs.push(wx);
            ys.push(ny);
            zs.push(wz);
            if (!list) this.cells.set(k, (list = []));
            list.push(id);
          }
        }
      }
    }
    const n = (this.count = xs.length);
    this.x = Float32Array.from(xs);
    this.y = Float32Array.from(ys);
    this.z = Float32Array.from(zs);
    this.nb = new Int32Array(n * 8).fill(-1);
    this.clear = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.from = new Int32Array(n);
    this.mark = new Uint32Array(n);

    // links
    for (let i = 0; i < n; i++) {
      const ix = Math.floor(this.x[i] / CELL);
      const iz = Math.floor(this.z[i] / CELL);
      for (let d = 0; d < 4; d++) this.nb[i * 8 + d] = this.findAt(ix + DX[d], iz + DZ[d], this.y[i], STEP);
    }
    for (let i = 0; i < n; i++) {
      const ix = Math.floor(this.x[i] / CELL);
      const iz = Math.floor(this.z[i] / CELL);
      for (let d = 4; d < 8; d++) {
        // diagonals only when both orthogonal steps exist (no corner cutting)
        const a = this.nb[i * 8 + (DX[d] > 0 ? 0 : 1)];
        const b = this.nb[i * 8 + (DZ[d] > 0 ? 2 : 3)];
        if (a < 0 || b < 0) continue;
        this.nb[i * 8 + d] = this.findAt(ix + DX[d], iz + DZ[d], this.y[i], STEP);
      }
    }
    // clearance: breadth-first from boundary nodes
    const q: number[] = [];
    for (let i = 0; i < n; i++) {
      let open = true;
      for (let d = 0; d < 8; d++) if (this.nb[i * 8 + d] < 0) open = false;
      this.clear[i] = open ? 255 : 1;
      if (!open) q.push(i);
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      const c = this.clear[i];
      if (c >= 6) continue;
      for (let d = 0; d < 4; d++) {
        const j = this.nb[i * 8 + d];
        if (j >= 0 && this.clear[j] > c + 1) {
          this.clear[j] = c + 1;
          q.push(j);
        }
      }
    }
    // cover: boundary nodes with something solid beside them at crouch height
    for (let i = 0; i < n; i++) {
      if (this.clear[i] !== 1) continue;
      for (let d = 0; d < 4; d++) {
        if (this.nb[i * 8 + d] >= 0) continue;
        _o.set(this.x[i], this.y[i] + 0.75, this.z[i]);
        _d.set(DX[d], 0, DZ[d]);
        const lowHit = G.col.raycast(_o, _d, CELL * 1.15, 'static');
        if (!lowHit) continue; // a drop, not a wall
        _o.y = this.y[i] + 1.55;
        const highHit = G.col.raycast(_o, _d, CELL * 1.6, 'static');
        const spot: CoverSpot = { node: i, dx: DX[d], dz: DZ[d], low: !highHit };
        const idx = this.covers.length;
        this.covers.push(spot);
        const ck = this.key(Math.floor(this.x[i] / 8), Math.floor(this.z[i] / 8));
        let l = this.coverGrid.get(ck);
        if (!l) this.coverGrid.set(ck, (l = []));
        l.push(idx);
      }
    }
    console.info(`[nav] ${n} nodes, ${this.covers.length} cover spots, ${(performance.now() - t0).toFixed(0)} ms`);
  }

  private findAt(ix: number, iz: number, y: number, tol: number) {
    const list = this.cells.get(this.key(ix, iz));
    if (!list) return -1;
    let best = -1;
    let bd = tol;
    for (const n of list) {
      const dy = Math.abs(this.y[n] - y);
      if (dy <= bd) {
        bd = dy;
        best = n;
      }
    }
    return best;
  }

  /** Node under a world position (same cell), or -1. */
  nodeAt(px: number, py: number, pz: number, tol = 1.2) {
    return this.findAt(Math.floor(px / CELL), Math.floor(pz / CELL), py, tol);
  }

  /** Closest node within a few cells of a position. */
  nearest(pos: THREE.Vector3, range = 3, tolY = 2.5) {
    const ix = Math.floor(pos.x / CELL);
    const iz = Math.floor(pos.z / CELL);
    const direct = this.findAt(ix, iz, pos.y, 1.2);
    if (direct >= 0) return direct;
    let best = -1;
    let bd = 1e9;
    const r = Math.ceil(range / CELL);
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const list = this.cells.get(this.key(ix + dx, iz + dz));
        if (!list) continue;
        for (const n of list) {
          const dy = this.y[n] - pos.y;
          if (Math.abs(dy) > tolY) continue;
          const d = (this.x[n] - pos.x) ** 2 + (this.z[n] - pos.z) ** 2 + dy * dy * 2;
          if (d < bd) {
            bd = d;
            best = n;
          }
        }
      }
    return best;
  }

  pos(node: number, out: THREE.Vector3) {
    return out.set(this.x[node], this.y[node], this.z[node]);
  }

  /** Walkable height under a point, or null if it is off the mesh. */
  heightAt(px: number, py: number, pz: number): number | null {
    const n = this.nodeAt(px, py, pz, 1.0);
    return n < 0 ? null : this.y[n];
  }

  /** Random reachable-looking node within [rMin, rMax] of a position. */
  randomNear(pos: THREE.Vector3, rMin: number, rMax: number, tries = 12): number {
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rMin + Math.random() * (rMax - rMin);
      _p.set(pos.x + Math.cos(a) * r, pos.y, pos.z + Math.sin(a) * r);
      const n = this.nearest(_p, 1.6, 2.0);
      if (n >= 0 && !this.claimed.has(n)) return n;
    }
    return -1;
  }

  claim(node: number, owner: number) {
    this.claimed.set(node, owner);
  }
  release(owner: number) {
    for (const [k, v] of this.claimed) if (v === owner) this.claimed.delete(k);
  }
  isClaimed(node: number, by?: number) {
    const o = this.claimed.get(node);
    return o !== undefined && o !== by;
  }

  /** Straight walkable line between two points? (samples the grid along the way) */
  walkable(a: THREE.Vector3, b: THREE.Vector3) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / (CELL * 0.5)));
    let y = a.y;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const n = this.nodeAt(a.x + dx * t, y, a.z + dz * t, 0.75);
      if (n < 0 || this.clear[n] < 2) return false;
      y = this.y[n];
    }
    return Math.abs(y - b.y) < 0.9;
  }

  // ------------------------------------------------------------------ A*

  private heapPush(n: number) {
    const h = this.heap;
    const f = this.f;
    let i = h.length;
    h.push(n);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (f[h[p]] <= f[n]) break;
      h[i] = h[p];
      i = p;
    }
    h[i] = n;
  }
  private heapPop() {
    const h = this.heap;
    const f = this.f;
    const top = h[0];
    const last = h.pop()!;
    const len = h.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= len) break;
        if (c + 1 < len && f[h[c + 1]] < f[h[c]]) c++;
        if (f[h[c]] >= f[last]) break;
        h[i] = h[c];
        i = c;
      }
      h[i] = last;
    }
    return top;
  }

  /**
   * Shortest path between two world positions as smoothed waypoints (excluding the start).
   * Returns null when unreachable within the search budget.
   */
  findPath(from: THREE.Vector3, to: THREE.Vector3, maxExpand = 5000): THREE.Vector3[] | null {
    const s = this.nearest(from, 3);
    const e = this.nearest(to, 4);
    if (s < 0 || e < 0) return null;
    if (s === e) return [to.clone().setY(this.y[e])];
    const stamp = ++this.stamp;
    const { g, f, mark, x, y, z, nb, clear } = this;
    this.heap.length = 0;
    g[s] = 0;
    f[s] = 0;
    this.from[s] = -1;
    mark[s] = stamp;
    this.heapPush(s);
    const ex = x[e];
    const ey = y[e];
    const ez = z[e];
    let expanded = 0;
    let found = false;
    // closed set marker uses the top bit trick: store stamp for open, track closed in a parallel pass via g check
    while (this.heap.length) {
      const cur = this.heapPop();
      if (cur === e) {
        found = true;
        break;
      }
      if (++expanded > maxExpand) break;
      const gc = g[cur];
      for (let d = 0; d < 8; d++) {
        const j = nb[cur * 8 + d];
        if (j < 0) continue;
        // hugging walls is slightly more expensive, so paths prefer the middle of corridors
        const step = DCOST[d] * CELL * (clear[j] <= 1 ? 1.6 : clear[j] === 2 ? 1.15 : 1) + Math.abs(y[j] - y[cur]) * 0.5;
        const ng = gc + step;
        if (mark[j] === stamp && ng >= g[j]) continue;
        g[j] = ng;
        const hx = x[j] - ex;
        const hy = y[j] - ey;
        const hz = z[j] - ez;
        f[j] = ng + Math.sqrt(hx * hx + hy * hy + hz * hz);
        this.from[j] = cur;
        mark[j] = stamp;
        this.heapPush(j);
      }
    }
    if (!found) return null;
    // walk back
    const raw: number[] = [];
    for (let n = e; n >= 0; n = this.from[n]) raw.push(n);
    raw.reverse();
    // string-pull: skip nodes while the straight line stays walkable
    const pts: THREE.Vector3[] = [];
    let anchor = new THREE.Vector3(x[s], y[s], z[s]);
    let i = 1;
    const tmp = new THREE.Vector3();
    while (i < raw.length) {
      let far = i;
      for (let j = Math.min(raw.length - 1, i + 14); j > i; j--) {
        tmp.set(x[raw[j]], y[raw[j]], z[raw[j]]);
        if (this.walkable(anchor, tmp)) {
          far = j;
          break;
        }
      }
      const p = new THREE.Vector3(x[raw[far]], y[raw[far]], z[raw[far]]);
      pts.push(p);
      anchor = p;
      i = far + 1;
    }
    // finish exactly on the requested point if it is on the mesh
    const last = pts[pts.length - 1];
    if (last && Math.hypot(to.x - last.x, to.z - last.z) < CELL * 1.5) last.set(to.x, y[e], to.z);
    return pts;
  }

  // ------------------------------------------------------------------ cover

  /**
   * Best cover spot near `from` that hides from `threat`.
   * `minT`/`maxT`: acceptable distance band to the threat.
   */
  findCover(from: THREE.Vector3, threat: THREE.Vector3, maxDist: number, minT: number, maxT: number, owner: number, preferFar = false): { pos: THREE.Vector3; node: number; low: boolean } | null {
    let best: CoverSpot | null = null;
    let bestScore = -1e9;
    const cr = Math.ceil(maxDist / 8);
    const cx = Math.floor(from.x / 8);
    const cz = Math.floor(from.z / 8);
    let tested = 0;
    for (let ix = -cr; ix <= cr; ix++)
      for (let iz = -cr; iz <= cr; iz++) {
        const list = this.coverGrid.get(this.key(cx + ix, cz + iz));
        if (!list) continue;
        for (const ci of list) {
          const c = this.covers[ci];
          const n = c.node;
          const px = this.x[n];
          const py = this.y[n];
          const pz = this.z[n];
          if (Math.abs(py - from.y) > 2.2) continue;
          const dFrom = Math.hypot(px - from.x, pz - from.z);
          if (dFrom > maxDist) continue;
          const tx = threat.x - px;
          const tz = threat.z - pz;
          const dT = Math.hypot(tx, tz);
          if (dT < minT || dT > maxT) continue;
          // the solid thing must be between us and the threat
          const facing = (c.dx * tx + c.dz * tz) / (dT || 1);
          if (facing < 0.55) continue;
          if (this.isClaimed(n, owner)) continue;
          let score = facing * 3 - dFrom * 0.22 + (c.low ? 1.2 : 0);
          score += preferFar ? dT * 0.12 : -Math.abs(dT - (minT + maxT) * 0.45) * 0.06;
          if (score <= bestScore) continue;
          // expensive check last: crouched here, is the threat really hidden?
          if (++tested > 14) continue;
          _o.set(px, py + 0.8, pz);
          _p.copy(threat);
          if (G.col.lineOfSight(_o, _p)) continue;
          bestScore = score;
          best = c;
        }
      }
    if (!best) return null;
    return { pos: new THREE.Vector3(this.x[best.node], this.y[best.node], this.z[best.node]), node: best.node, low: best.low };
  }
}
