import * as THREE from 'three';
import { toon, RAMP_CHAR, type ToonOpts } from './toon';

type V3 = [number, number, number];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _c = new THREE.Color();

/** One cross-section of a sculpted form (see `loftGeometry`). Front is -Z. */
export interface Ring {
  /** height of the section */
  y: number;
  /** half width (x) */
  w: number;
  /** depth towards the front */
  f: number;
  /** depth towards the back */
  b: number;
  /** section shape: 2 = ellipse, higher = squarer (default 2.5: neither a tube nor a box) */
  n?: number;
  /** extra forward push at the front centre (nose, chin, kneecap) and its half width */
  nose?: number;
  nw?: number;
  /** pull the front back either side of the centre (eye sockets) */
  sock?: number;
  /**
   * For a section set off to one side (`x`): its half width and shape on the side facing the body's
   * centre line. With a square-ish `nm` two such sections sit flush against each other, like the two
   * halves of a pair of trousers.
   */
  wm?: number;
  nm?: number;
  /** the same shape setting for the front half only (a flat trouser front over a shaped seat) */
  nmf?: number;
  /** centre offset */
  x?: number;
  z?: number;
}

export interface LoftOpts {
  sides?: number;
  /** push the whole surface outwards (clothing worn over a body, decals) */
  grow?: number;
  /** only the faces from side `from` up to `to`; side 0 starts at the front centre and runs towards +X */
  from?: number;
  to?: number;
  pick?: (seg: number, side: number) => boolean;
  /** only the ring segments from `segs[0]` up to `segs[1]` (the rest still shape the shading) */
  segs?: [number, number];
}

/**
 * Skin a stack of cross-sections into a smooth-shaded mesh: the way low-poly characters are
 * actually modelled (a jaw, a brow, a ribcage, a calf) rather than assembled from primitives.
 * UVs run 0..1 across the chosen sides and up the rings, so a drawn decal can be wrapped on.
 */
export function loftGeometry(rings: Ring[], o: LoftOpts = {}) {
  const sides = o.sides ?? 16;
  const grow = o.grow ?? 0;
  const from = o.from ?? 0;
  const to = o.to ?? sides;
  const R = rings.length;
  const P: THREE.Vector3[][] = [];
  for (let j = 0; j < R; j++) {
    const r = rings[j];
    const e = 2 / (r.n ?? 2.5);
    const row: THREE.Vector3[] = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const sn = Math.sin(a);
      const cs = Math.cos(a);
      const inner = r.wm !== undefined && ((r.x ?? 0) > 0 ? sn < 0 : (r.x ?? 0) < 0 && sn > 0);
      const ek = inner ? 2 / ((cs >= 0 ? r.nmf : undefined) ?? r.nm ?? r.n ?? 2.5) : e;
      let px = Math.sign(sn) * Math.pow(Math.abs(sn), ek) * (inner ? r.wm! : r.w);
      let pz = -Math.sign(cs) * Math.pow(Math.abs(cs), ek) * (cs >= 0 ? r.f : r.b);
      if (cs > 0) {
        if (r.nose) pz -= r.nose * Math.max(0, 1 - Math.abs(px) / (r.nw ?? 0.03));
        if (r.sock && r.w > 0) pz += r.sock * Math.max(0, 1 - Math.abs(Math.abs(px) / r.w - 0.5) / 0.35);
      }
      if (grow) {
        const len = Math.hypot(px, pz) || 1;
        px += (px / len) * grow;
        pz += (pz / len) * grow;
      }
      row.push(new THREE.Vector3(px + (r.x ?? 0), r.y, pz + (r.z ?? 0)));
    }
    P.push(row);
  }
  const at = (j: number, k: number) => P[j][((k % sides) + sides) % sides];
  const N: THREE.Vector3[][] = [];
  const tk = new THREE.Vector3();
  const tj = new THREE.Vector3();
  for (let j = 0; j < R; j++) {
    const row: THREE.Vector3[] = [];
    const up = rings[Math.min(R - 1, j + 1)].y >= rings[Math.max(0, j - 1)].y ? 1 : -1;
    for (let k = 0; k < sides; k++) {
      tk.subVectors(at(j, k + 1), at(j, k - 1));
      tj.subVectors(at(Math.min(R - 1, j + 1), k), at(Math.max(0, j - 1), k));
      const n = new THREE.Vector3().crossVectors(tk, tj);
      const p = at(j, k);
      const rx = p.x - (rings[j].x ?? 0);
      const rz = p.z - (rings[j].z ?? 0);
      if (n.lengthSq() < 1e-14) n.set(0, (j === 0 ? -1 : 1) * up, 0);
      else {
        n.normalize();
        if (n.x * rx + n.z * rz < 0) n.negate();
      }
      row.push(n);
    }
    N.push(row);
  }
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const y0 = Math.min(...rings.map((r) => r.y));
  const y1 = Math.max(...rings.map((r) => r.y));
  const fn = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const tri = (a: [number, number], b: [number, number], c: [number, number]) => {
    const pa = at(a[0], a[1]);
    let pb = at(b[0], b[1]);
    let pc = at(c[0], c[1]);
    fn.crossVectors(e1.subVectors(pb, pa), e2.subVectors(pc, pa));
    if (fn.lengthSq() < 1e-16) return;
    const na = N[a[0]][((a[1] % sides) + sides) % sides];
    const nb = N[b[0]][((b[1] % sides) + sides) % sides];
    const nc = N[c[0]][((c[1] % sides) + sides) % sides];
    let order: [[number, number], THREE.Vector3, THREE.Vector3][] = [[a, pa, na], [b, pb, nb], [c, pc, nc]];
    if (fn.dot(e1.copy(na).add(nb).add(nc)) < 0) order = [order[0], order[2], order[1]];
    for (const [idx, pp, nn] of order) {
      pos.push(pp.x, pp.y, pp.z);
      nrm.push(nn.x, nn.y, nn.z);
      uv.push((idx[1] - from) / (to - from), (rings[idx[0]].y - y0) / (y1 - y0 || 1));
    }
  };
  for (let j = Math.max(0, o.segs?.[0] ?? 0); j < Math.min(R - 1, o.segs?.[1] ?? R - 1); j++)
    for (let k = from; k < to; k++) {
      if (o.pick && !o.pick(j, k)) continue;
      tri([j, k], [j, k + 1], [j + 1, k + 1]);
      tri([j, k], [j + 1, k + 1], [j + 1, k]);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/**
 * Builds one merged, vertex-coloured, flat-shaded mesh out of simple primitives.
 * Everything procedural in the game (guns, arms, characters, vehicles, props) goes through this,
 * which keeps each moving part to a single draw call and gives the whole game one consistent look.
 */
export class Kit {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  /** optional per-vertex bone index for rigid skinning */
  private bone: number[] = [];
  curBone = 0;
  private stack: THREE.Matrix4[] = [];
  private cur = new THREE.Matrix4();

  /** Subsequent primitives are transformed by this local frame (position + Euler XYZ in radians). */
  push(pos: V3, rot: V3 = [0, 0, 0], scale: V3 | number = 1) {
    this.stack.push(this.cur.clone());
    const sc = typeof scale === 'number' ? _s.set(scale, scale, scale) : _s.set(scale[0], scale[1], scale[2]);
    _m.compose(_p.set(pos[0], pos[1], pos[2]), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], 'XYZ')), sc);
    this.cur.multiply(_m);
    return this;
  }
  pop() {
    this.cur = this.stack.pop() ?? new THREE.Matrix4();
    return this;
  }

  /** Append a geometry (flat or smooth as provided). `shade`: per-vertex darkening function of local position. */
  add(geo: THREE.BufferGeometry, color: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], smooth = false, scale: V3 = [1, 1, 1]) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (!smooth) {
      g = g === geo ? geo.clone() : g;
      g.deleteAttribute('normal');
      g.computeVertexNormals();
    } else if (!g.getAttribute('normal')) g.computeVertexNormals();
    _m.compose(_p.set(pos[0], pos[1], pos[2]), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], 'XYZ')), _s.set(scale[0], scale[1], scale[2]));
    const m = this.cur.clone().multiply(_m);
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    _c.setHex(color);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      v.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(nm).normalize();
      this.nrm.push(v.x, v.y, v.z);
      this.col.push(_c.r, _c.g, _c.b);
      if (u) this.uv.push(u.getX(i), u.getY(i));
      else this.uv.push(0, 0);
      this.bone.push(this.curBone);
    }
    if (g !== geo) g.dispose();
    return this;
  }

  /**
   * Smooth solid of revolution about Y, for rounded bodies and limbs. `pts` are [radius, y] pairs
   * running up (or down) the shape; `sx` / `sz` squash it; `gap` (radians) leaves it open at the
   * front (-Z), e.g. for an unbuttoned vest.
   */
  lathe(pts: [number, number][], color: number, pos: V3 = [0, 0, 0], sx = 1, sz = 1, sides = 14, gap = 0) {
    const make = (p: [number, number][]) => new THREE.LatheGeometry(p.map(([r, y]) => new THREE.Vector2(r, y)), sides, Math.PI + gap / 2, Math.PI * 2 - gap);
    let g = make(pts);
    // face outwards whichever way the points run
    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    let out = 0;
    for (let i = 0; i < P.count; i++) out += P.getX(i) * N.getX(i) + P.getZ(i) * N.getZ(i);
    if (out < 0) {
      g.dispose();
      g = make(pts.slice().reverse());
    }
    this.add(g, color, pos, [0, 0, 0], true, [sx, 1, sz]);
    g.dispose();
    return this;
  }

  /**
   * A sculpted form from cross-sections (see `loftGeometry`). `color` may be a function of the
   * face — (ring segment, distance from the front in sides, side) — to paint regions such as hair,
   * a belt or a reflective band without adding geometry.
   */
  loft(rings: Ring[], color: number | ((seg: number, d: number, side: number) => number), o: LoftOpts & { pos?: V3; rot?: V3 } = {}) {
    const sides = o.sides ?? 16;
    const colourOf = (seg: number, k: number) => {
      if (typeof color === 'number') return color;
      const ks = ((k % sides) + sides) % sides;
      const fr = ks < sides / 2 ? ks : ks - sides;
      return color(seg, Math.abs(fr + 0.5), ks);
    };
    const seen = new Set<number>();
    for (let j = 0; j < rings.length - 1; j++) for (let k = o.from ?? 0; k < (o.to ?? sides); k++) seen.add(colourOf(j, k));
    for (const c of seen) {
      const g = loftGeometry(rings, { ...o, pick: (j, k) => colourOf(j, k) === c });
      if (g.getAttribute('position').count) this.add(g, c, o.pos ?? [0, 0, 0], o.rot ?? [0, 0, 0], true);
      g.dispose();
    }
    return this;
  }

  /** Smooth dome (the top `frac` of a sphere), for hair, hats and helmets. */
  dome(r: number, color: number, pos: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], frac = 0.5, rot: V3 = [0, 0, 0]) {
    const g = new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI * frac);
    this.add(g, color, pos, rot, true, scale);
    g.dispose();
    return this;
  }

  box(w: number, h: number, d: number, color: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]) {
    const g = new THREE.BoxGeometry(w, h, d);
    this.add(g, color, pos, rot);
    g.dispose();
    return this;
  }

  /**
   * Box whose top face is scaled (taper) – good for limbs, grips, wedges.
   * `tx`,`tz` scale the +Y face in x and z.
   */
  taper(w: number, h: number, d: number, tx: number, tz: number, color: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]) {
    const g = new THREE.BoxGeometry(w, h, d);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0) {
        p.setX(i, p.getX(i) * tx);
        p.setZ(i, p.getZ(i) * tz);
      }
    }
    this.add(g, color, pos, rot);
    g.dispose();
    return this;
  }

  /** Cylinder along an axis ('x' | 'y' | 'z'), centred at pos. */
  cyl(r1: number, r2: number, len: number, color: number, pos: V3 = [0, 0, 0], axis: 'x' | 'y' | 'z' = 'z', sides = 8, smooth = true, rot: V3 = [0, 0, 0]) {
    const g = new THREE.CylinderGeometry(r2, r1, len, sides, 1, false);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    else if (axis === 'x') g.rotateZ(-Math.PI / 2);
    this.add(g, color, pos, rot, smooth);
    g.dispose();
    return this;
  }

  sphere(r: number, color: number, pos: V3 = [0, 0, 0], detail = 0, scale: V3 = [1, 1, 1], smooth = false) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    g.scale(scale[0], scale[1], scale[2]);
    this.add(g, color, pos, [0, 0, 0], smooth);
    g.dispose();
    return this;
  }

  /**
   * Extrude a 2D side profile. Points are [z, y] pairs (z = along the barrel, forward is NEGATIVE z,
   * y = up); the shape is given `width` along x, centred. Great for receivers, grips and stocks.
   */
  profile(pts: [number, number][], width: number, color: number, pos: V3 = [0, 0, 0], bevel = 0, rot: V3 = [0, 0, 0]) {
    const shape = new THREE.Shape();
    // map profile (z,y) -> shape (x= -z, y) so that after rotating the extrusion, forward ends up at -z
    pts.forEach((p, i) => (i === 0 ? shape.moveTo(-p[0], p[1]) : shape.lineTo(-p[0], p[1])));
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: width - bevel * 2,
      bevelEnabled: bevel > 0,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 1,
      steps: 1,
    });
    // extrusion runs along +z in shape space; rotate so shape-x -> -z (forward) and depth -> x
    g.translate(0, 0, -(width - bevel * 2) / 2);
    g.rotateY(Math.PI / 2);
    this.add(g, color, pos, rot);
    g.dispose();
    return this;
  }

  /** Flat quad with UVs 0..1 (for decals / screens). Faces +Z before rotation. */
  quad(w: number, h: number, color: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], uvRect: [number, number, number, number] = [0, 0, 1, 1]) {
    const g = new THREE.PlaneGeometry(w, h);
    const u = g.getAttribute('uv');
    for (let i = 0; i < u.count; i++) {
      u.setXY(i, uvRect[0] + u.getX(i) * (uvRect[2] - uvRect[0]), uvRect[1] + u.getY(i) * (uvRect[3] - uvRect[1]));
    }
    this.add(g, color, pos, rot, true);
    g.dispose();
    return this;
  }

  get empty() {
    return this.pos.length === 0;
  }
  get vertexCount() {
    return this.pos.length / 3;
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  /** Geometry with skinIndex/skinWeight so every vertex follows exactly one bone (rigid skinning). */
  skinnedGeometry() {
    const g = this.geometry();
    const n = this.bone.length;
    const idx = new Uint16Array(n * 4);
    const wgt = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      idx[i * 4] = this.bone[i];
      wgt[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wgt, 4));
    return g;
  }

  mesh(opts: ToonOpts = {}) {
    const m = new THREE.Mesh(this.geometry(), toon({ vertexColors: true, ramp: RAMP_CHAR, ...opts }));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  /** Split the geometry per bone (used to turn a character into flying parts when it is destroyed). */
  splitByBone(): Map<number, THREE.BufferGeometry> {
    const out = new Map<number, { pos: number[]; nrm: number[]; col: number[] }>();
    for (let i = 0; i < this.bone.length; i++) {
      const b = this.bone[i];
      let o = out.get(b);
      if (!o) out.set(b, (o = { pos: [], nrm: [], col: [] }));
      o.pos.push(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      o.nrm.push(this.nrm[i * 3], this.nrm[i * 3 + 1], this.nrm[i * 3 + 2]);
      o.col.push(this.col[i * 3], this.col[i * 3 + 1], this.col[i * 3 + 2]);
    }
    const res = new Map<number, THREE.BufferGeometry>();
    for (const [b, o] of out) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(o.nrm, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(o.col, 3));
      res.set(b, g);
    }
    return res;
  }
}

/** Set render layer on an object and all descendants. */
export function setLayer(obj: THREE.Object3D, layer: number) {
  obj.traverse((o) => o.layers.set(layer));
}

export function setShadows(obj: THREE.Object3D, cast: boolean, receive: boolean) {
  obj.traverse((o) => {
    o.castShadow = cast;
    o.receiveShadow = receive;
  });
}
