import * as THREE from 'three';
import { toon, RAMP_CHAR, type ToonOpts } from './toon';

type V3 = [number, number, number];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _c = new THREE.Color();

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
  add(geo: THREE.BufferGeometry, color: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], smooth = false) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (!smooth) {
      g = g === geo ? geo.clone() : g;
      g.deleteAttribute('normal');
      g.computeVertexNormals();
    } else if (!g.getAttribute('normal')) g.computeVertexNormals();
    _m.compose(_p.set(pos[0], pos[1], pos[2]), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], 'XYZ')), _s.set(1, 1, 1));
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
  profile(pts: [number, number][], width: number, color: number, pos: V3 = [0, 0, 0], bevel = 0) {
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
    this.add(g, color, pos);
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
