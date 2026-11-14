import * as THREE from 'three';
import { textures, type TexSet } from '../render/textures';
import { toon, RAMP_WORLD } from '../render/toon';

export type MatName = keyof TexSet;

/** Surface kinds drive footstep + bullet impact sounds and particles. */
export const enum Surf {
  Concrete = 0,
  Metal = 1,
  Sand = 2,
  Wood = 3,
  Glass = 4,
  Rock = 5,
}

const MAT_SURF: Record<MatName, Surf> = {
  plain: Surf.Concrete,
  concrete: Surf.Concrete,
  panel: Surf.Metal,
  corrugated: Surf.Metal,
  asphalt: Surf.Concrete,
  sand: Surf.Sand,
  rock: Surf.Rock,
  wood: Surf.Wood,
  hazard: Surf.Metal,
  tile: Surf.Concrete,
  grate: Surf.Metal,
  cardboard: Surf.Wood,
};

type V3 = [number, number, number];

export interface ShapeOpts {
  mat?: MatName;
  color?: number;
  /** metres per texture repeat */
  uv?: number;
  collide?: boolean;
  visible?: boolean;
  surf?: Surf;
  /** darken the lower edge of vertical faces (cheap baked ambient occlusion) */
  ao?: boolean;
  /** colour override for upward-facing faces */
  topColor?: number;
}

export interface BoxOpts extends ShapeOpts {
  pos: V3;
  size: V3;
  rot?: V3;
  /** skip faces: any of 'px','nx','py','ny','pz','nz' */
  skip?: string[];
}

class Batch {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] = [];
}

const CHUNK = 64;
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);

/**
 * Accumulates level geometry into a handful of merged, vertex-coloured meshes (one per texture per
 * spatial chunk) plus one triangle soup for collision.
 */
export class GeoBuilder {
  private batches = new Map<string, Batch>();
  private colPos: number[] = [];
  private colSurf: number[] = [];
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  /** extra un-merged objects (signs, lights, animated props) */
  readonly extras: THREE.Object3D[] = [];

  get m() {
    return this.stack[this.stack.length - 1];
  }

  /** Run `fn` with a local transform applied to everything it emits. */
  at(pos: V3, rotY: number, fn: () => void, rotX = 0, rotZ = 0, scale = 1) {
    const m = new THREE.Matrix4().compose(
      _v.set(pos[0], pos[1], pos[2]).clone(),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')),
      scale === 1 ? _one : new THREE.Vector3(scale, scale, scale),
    );
    this.stack.push(this.m.clone().multiply(m));
    try {
      fn();
    } finally {
      this.stack.pop();
    }
  }

  private batchFor(mat: MatName, x: number, z: number) {
    const key = mat + '|' + Math.floor(x / CHUNK) + '|' + Math.floor(z / CHUNK);
    let b = this.batches.get(key);
    if (!b) this.batches.set(key, (b = new Batch()));
    return b;
  }

  /**
   * Low-level: emit one convex polygon (fan triangulated) in local space.
   * `uvAxis`: which local axes map to u,v.
   */
  poly(pts: V3[], normal: V3, o: ShapeOpts, colors?: number[], uvFn?: (p: V3) => [number, number]) {
    const mat = o.mat ?? 'concrete';
    const m = this.m;
    const uvScale = 1 / (o.uv ?? 4);
    _m3.setFromMatrix4(m);
    _n.set(normal[0], normal[1], normal[2]).applyMatrix3(_m3).normalize();
    const nx = _n.x;
    const ny = _n.y;
    const nz = _n.z;
    // local-space planar UV chosen from the dominant normal axis
    const ax = Math.abs(normal[0]);
    const ay = Math.abs(normal[1]);
    const az = Math.abs(normal[2]);
    const uvOf =
      uvFn ??
      ((p: V3): [number, number] =>
        ay >= ax && ay >= az ? [p[0] * uvScale, p[2] * uvScale] : ax >= az ? [p[2] * uvScale, p[1] * uvScale] : [p[0] * uvScale, p[1] * uvScale]);

    const wp: number[] = [];
    for (const p of pts) {
      _v.set(p[0], p[1], p[2]).applyMatrix4(m);
      wp.push(_v.x, _v.y, _v.z);
    }
    const visible = o.visible !== false;
    const collide = o.collide !== false;
    const surf = o.surf ?? MAT_SURF[mat];
    let b: Batch | null = null;
    if (visible) b = this.batchFor(mat, wp[0], wp[2]);
    const base = o.color ?? 0xffffff;
    for (let i = 1; i < pts.length - 1; i++) {
      const idx = [0, i, i + 1];
      for (const k of idx) {
        if (b) {
          b.pos.push(wp[k * 3], wp[k * 3 + 1], wp[k * 3 + 2]);
          b.nrm.push(nx, ny, nz);
          const uv = uvOf(pts[k]);
          b.uv.push(uv[0], uv[1]);
          _c.setHex(colors ? colors[k] : base);
          b.col.push(_c.r, _c.g, _c.b);
        }
        if (collide) {
          this.colPos.push(wp[k * 3], wp[k * 3 + 1], wp[k * 3 + 2]);
          this.colSurf.push(surf);
        }
      }
    }
  }

  private shadeHex(hex: number, f: number) {
    _c2.setHex(hex).multiplyScalar(f);
    return _c2.getHex();
  }

  /** Axis-aligned (in local space) box. `pos` is the centre. */
  box(o: BoxOpts) {
    const [sx, sy, sz] = o.size;
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const inner = () => {
      const col = o.color ?? 0xffffff;
      const ao = o.ao !== false && sy > 0.9;
      const lo = ao ? this.shadeHex(col, 0.78) : col;
      const top = o.topColor ?? col;
      const skip = o.skip ?? [];
      const sideCols = [lo, lo, col, col];
      if (!skip.includes('px')) this.poly([[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]], [1, 0, 0], o, sideCols);
      if (!skip.includes('nx')) this.poly([[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]], [-1, 0, 0], o, sideCols);
      if (!skip.includes('pz')) this.poly([[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], [0, 0, 1], o, sideCols);
      if (!skip.includes('nz')) this.poly([[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], [0, 0, -1], o, sideCols);
      if (!skip.includes('py')) this.poly([[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]], [0, 1, 0], o, [top, top, top, top]);
      if (!skip.includes('ny')) {
        const bc = this.shadeHex(col, 0.6);
        this.poly([[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]], [0, -1, 0], o, [bc, bc, bc, bc]);
      }
    };
    if (o.rot && (o.rot[0] || o.rot[1] || o.rot[2])) this.at(o.pos, o.rot[1], inner, o.rot[0], o.rot[2]);
    else this.at(o.pos, 0, inner);
  }

  /** Box given by min corner + size (handy for floors and walls laid out on a plan). */
  slab(x: number, y: number, z: number, sx: number, sy: number, sz: number, o: ShapeOpts = {}) {
    this.box({ ...o, pos: [x + sx / 2, y + sy / 2, z + sz / 2], size: [sx, sy, sz] });
  }

  /**
   * Wedge ramp. `pos` = centre of the base rectangle, rises from local -Z (height 0) to +Z (height h).
   */
  ramp(o: { pos: V3; size: V3; rotY?: number } & ShapeOpts) {
    const [w, h, l] = o.size;
    const hw = w / 2;
    const hl = l / 2;
    this.at(o.pos, o.rotY ?? 0, () => {
      const col = o.color ?? 0xffffff;
      const lo = this.shadeHex(col, 0.78);
      const len = Math.hypot(h, l);
      const top = o.topColor ?? col;
      // sloped top
      this.poly([[-hw, 0, -hl], [-hw, h, hl], [hw, h, hl], [hw, 0, -hl]], [0, l / len, -h / len], o, [top, top, top, top], (p) => [
        p[0] / (o.uv ?? 4),
        (((p[2] + hl) / l) * len) / (o.uv ?? 4),
      ]);
      // back wall
      this.poly([[-hw, 0, hl], [hw, 0, hl], [hw, h, hl], [-hw, h, hl]], [0, 0, 1], o, [lo, lo, col, col]);
      // sides
      this.poly([[hw, 0, hl], [hw, 0, -hl], [hw, h, hl]], [1, 0, 0], o, [lo, lo, col]);
      this.poly([[-hw, 0, -hl], [-hw, 0, hl], [-hw, h, hl]], [-1, 0, 0], o, [lo, lo, col]);
    });
  }

  /** Visual steps with a smooth invisible ramp for collision (so characters glide up). */
  stairs(o: { pos: V3; size: V3; rotY?: number; steps?: number } & ShapeOpts) {
    const [w, h, l] = o.size;
    const n = o.steps ?? Math.max(2, Math.round(h / 0.25));
    this.at(o.pos, o.rotY ?? 0, () => {
      for (let i = 0; i < n; i++) {
        const sh = (h / n) * (i + 1);
        const sl = l / n;
        this.box({ ...o, pos: [0, sh / 2, -l / 2 + sl * (i + 0.5)], size: [w, sh, sl], collide: false });
      }
      this.ramp({ ...o, pos: [0, 0, 0], size: [w, h, l], visible: false, collide: true });
    });
  }

  /**
   * Vertical prism from a convex XZ polygon. Points are counter-clockwise on a top-down map
   * drawn with +X to the right and +Z towards the bottom of the page.
   */
  prism(pts: [number, number][], y0: number, y1: number, o: ShapeOpts = {}) {
    const col = o.color ?? 0xffffff;
    const lo = o.ao === false ? col : this.shadeHex(col, 0.78);
    const top = o.topColor ?? col;
    const n = pts.length;
    // accept either winding
    let area = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (area > 0) pts = pts.slice().reverse();
    this.poly(pts.map((p) => [p[0], y1, p[1]] as V3), [0, 1, 0], o, new Array(n).fill(top));
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      // outward normal of edge a->b
      const nx = -dz / len;
      const nz = dx / len;
      this.poly([[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], [nx, 0, nz], o, [lo, lo, col, col], (p) => [
        Math.hypot(p[0] - a[0], p[2] - a[1]) / (o.uv ?? 4),
        p[1] / (o.uv ?? 4),
      ]);
    }
  }

  /** Upright cylinder / cone frustum with smooth sides. `pos` = centre of the base. */
  cyl(o: { pos: V3; r: number; r2?: number; h: number; sides?: number; rot?: V3 } & ShapeOpts) {
    const sides = o.sides ?? 10;
    const r1 = o.r;
    const r2 = o.r2 ?? o.r;
    const geo = new THREE.CylinderGeometry(r2, r1, o.h, sides, 1, false);
    geo.translate(0, o.h / 2, 0);
    const m = new THREE.Matrix4();
    if (o.rot) m.makeRotationFromEuler(_e.set(o.rot[0], o.rot[1], o.rot[2], 'YXZ'));
    m.setPosition(o.pos[0], o.pos[1], o.pos[2]);
    this.mesh(geo, m, o);
    geo.dispose();
  }

  /**
   * Merge an arbitrary geometry (local transform `local`, then the builder stack). Uses the geometry's own
   * normals and UVs (falls back to planar UVs); multiplies an optional `color` attribute by `o.color`.
   */
  mesh(geo: THREE.BufferGeometry, local: THREE.Matrix4 | null, o: ShapeOpts = {}) {
    const mat = o.mat ?? 'plain';
    const g = geo.index ? geo.toNonIndexed() : geo;
    const m = local ? this.m.clone().multiply(local) : this.m;
    _m3.getNormalMatrix(m);
    const pos = g.getAttribute('position');
    let nrm = g.getAttribute('normal');
    if (!nrm) {
      g.computeVertexNormals();
      nrm = g.getAttribute('normal');
    }
    const uv = g.getAttribute('uv');
    const colA = g.getAttribute('color');
    const visible = o.visible !== false;
    const collide = o.collide !== false;
    const surf = o.surf ?? MAT_SURF[mat];
    _v.set(pos.getX(0), pos.getY(0), pos.getZ(0)).applyMatrix4(m);
    const b = visible ? this.batchFor(mat, _v.x, _v.z) : null;
    const uvScale = 1 / (o.uv ?? 4);
    _c2.setHex(o.color ?? 0xffffff);
    const br = _c2.r;
    const bg = _c2.g;
    const bb = _c2.b;
    for (let i = 0; i < pos.count; i++) {
      _v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m);
      if (b) {
        b.pos.push(_v.x, _v.y, _v.z);
        _n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).applyMatrix3(_m3).normalize();
        b.nrm.push(_n.x, _n.y, _n.z);
        if (uv) b.uv.push(uv.getX(i), uv.getY(i));
        else b.uv.push(pos.getX(i) * uvScale + pos.getZ(i) * uvScale, pos.getY(i) * uvScale);
        if (colA) b.col.push(colA.getX(i) * br, colA.getY(i) * bg, colA.getZ(i) * bb);
        else b.col.push(br, bg, bb);
      }
      if (collide) {
        this.colPos.push(_v.x, _v.y, _v.z);
        this.colSurf.push(surf);
      }
    }
    if (g !== geo) g.dispose();
  }

  /** Invisible collision-only box. */
  blocker(pos: V3, size: V3, rotY = 0, surf = Surf.Concrete) {
    this.box({ pos, size, rot: [0, rotY, 0], visible: false, collide: true, surf });
  }

  /** Add a free-standing object (not merged). It is transformed by the current stack. */
  extra(obj: THREE.Object3D) {
    obj.applyMatrix4(this.m);
    this.extras.push(obj);
    return obj;
  }

  /** World-space position of a local point under the current transform. */
  world(p: V3, out = new THREE.Vector3()) {
    return out.set(p[0], p[1], p[2]).applyMatrix4(this.m);
  }

  /** Current stack yaw (handy for prefabs that register gameplay markers). */
  worldYaw() {
    _q.setFromRotationMatrix(this.m);
    _e.setFromQuaternion(_q, 'YXZ');
    return _e.y;
  }

  build() {
    const tex = textures();
    const group = new THREE.Group();
    group.name = 'level-static';
    let tris = 0;
    for (const [key, b] of this.batches) {
      const matName = key.split('|')[0] as MatName;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      tris += b.pos.length / 9;
      const mesh = new THREE.Mesh(geo, toon({ map: tex[matName], vertexColors: true, ramp: RAMP_WORLD }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'static:' + key;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    for (const e of this.extras) group.add(e);

    const collision = new THREE.BufferGeometry();
    collision.setAttribute('position', new THREE.Float32BufferAttribute(this.colPos, 3));
    collision.setAttribute('surf', new THREE.Uint8BufferAttribute(this.colSurf, 1));
    return { group, collision, tris, colTris: this.colPos.length / 9 };
  }
}
