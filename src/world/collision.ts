import * as THREE from 'three';
import { MeshBVH, type ExtendedTriangle } from 'three-mesh-bvh';
import { Surf } from './builder';

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  surf: Surf;
  /** dynamic box that was hit, or null for static level geometry */
  box: BoxCollider | null;
}

export interface MoveResult {
  grounded: boolean;
  groundNormal: THREE.Vector3;
  hitWall: boolean;
  hitCeiling: boolean;
  wallNormal: THREE.Vector3;
  surf: Surf;
}

export function newMoveResult(): MoveResult {
  return {
    grounded: false,
    groundNormal: new THREE.Vector3(0, 1, 0),
    hitWall: false,
    hitCeiling: false,
    wallNormal: new THREE.Vector3(),
    surf: Surf.Concrete,
  };
}

/** Oriented box collider for things that move or can be removed (gates, vehicles, crates). */
export class BoxCollider {
  readonly matrix = new THREE.Matrix4();
  readonly inv = new THREE.Matrix4();
  readonly half = new THREE.Vector3();
  enabled = true;
  /** blocks characters */
  solid = true;
  /** blocks bullets and sight */
  opaque = true;
  surf: Surf = Surf.Metal;
  owner: unknown = null;

  constructor(hx: number, hy: number, hz: number) {
    this.half.set(hx, hy, hz);
  }
  set(pos: THREE.Vector3, quat: THREE.Quaternion) {
    this.matrix.compose(pos, quat, ONE);
    this.inv.copy(this.matrix).invert();
    return this;
  }
  setYaw(x: number, y: number, z: number, yaw: number) {
    _q.setFromAxisAngle(UPV, yaw);
    return this.set(_p.set(x, y, z), _q);
  }
}

const ONE = new THREE.Vector3(1, 1, 1);
const UPV = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _ray = new THREE.Ray();
const _seg = new THREE.Line3();
const _aabb = new THREE.Box3();
const _triPoint = new THREE.Vector3();
const _capPoint = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _triN = new THREE.Vector3();
const _lo = new THREE.Vector3();
const _ld = new THREE.Vector3();
const _lc = new THREE.Vector3();
const _push = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _m3 = new THREE.Matrix3();

const WALKABLE_Y = 0.68; // ~47 degrees

export class CollisionWorld {
  private bvh: MeshBVH | null = null;
  private geo: THREE.BufferGeometry | null = null;
  private surfAttr: THREE.BufferAttribute | null = null;
  readonly boxes: BoxCollider[] = [];

  setStatic(geo: THREE.BufferGeometry) {
    this.geo = geo;
    this.bvh = new MeshBVH(geo, { targetLeafSize: 8 });
    this.surfAttr = geo.getAttribute('surf') as THREE.BufferAttribute;
  }

  clear() {
    this.bvh = null;
    this.geo = null;
    this.surfAttr = null;
    this.boxes.length = 0;
  }

  addBox(b: BoxCollider) {
    this.boxes.push(b);
    return b;
  }
  removeBox(b: BoxCollider) {
    const i = this.boxes.indexOf(b);
    if (i >= 0) this.boxes.splice(i, 1);
  }

  private surfOfFace(faceIndex: number): Surf {
    if (!this.geo || !this.surfAttr) return Surf.Concrete;
    const idx = this.geo.index;
    const v = idx ? idx.getX(faceIndex * 3) : faceIndex * 3;
    return this.surfAttr.getX(v) as Surf;
  }

  /**
   * Nearest hit along a ray. `dir` must be normalised.
   * `mode`: 'all' static + opaque boxes, 'static' level only, 'solid' static + solid boxes.
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, mode: 'all' | 'static' | 'solid' = 'all', ignore: BoxCollider | null = null): RayHit | null {
    let best: RayHit | null = null;
    let bestD = maxDist;
    if (this.bvh) {
      _ray.origin.copy(origin);
      _ray.direction.copy(dir);
      const hit = this.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, maxDist);
      if (hit && hit.distance <= bestD) {
        bestD = hit.distance;
        const n = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
        if (n.dot(dir) > 0) n.negate();
        best = { point: hit.point.clone(), normal: n, distance: hit.distance, surf: this.surfOfFace(hit.faceIndex ?? 0), box: null };
      }
    }
    if (mode !== 'static') {
      for (const b of this.boxes) {
        if (!b.enabled || b === ignore) continue;
        if (mode === 'all' ? !b.opaque : !b.solid) continue;
        const t = rayBox(origin, dir, b, bestD);
        if (t >= 0 && t < bestD) {
          bestD = t;
          best = {
            point: origin.clone().addScaledVector(dir, t),
            normal: _rayBoxNormal.clone().transformDirection(b.matrix),
            distance: t,
            surf: b.surf,
            box: b,
          };
        }
      }
    }
    return best;
  }

  /** True when nothing opaque lies between a and b. */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3, ignore: BoxCollider | null = null) {
    _dir.copy(b).sub(a);
    const d = _dir.length();
    if (d < 1e-4) return true;
    _dir.multiplyScalar(1 / d);
    if (this.bvh) {
      _ray.origin.copy(a);
      _ray.direction.copy(_dir);
      if (this.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, d - 0.02)) return false;
    }
    for (const bx of this.boxes) {
      if (!bx.enabled || !bx.opaque || bx === ignore) continue;
      const t = rayBox(a, _dir, bx, d);
      if (t >= 0 && t < d - 0.02) return false;
    }
    return true;
  }

  /** Height of the walkable surface under (x,z), searching downward from `fromY`. */
  groundY(x: number, z: number, fromY: number, maxDrop = 50): number | null {
    const h = this.raycast(_p.set(x, fromY, z), DOWN, maxDrop, 'solid');
    return h ? h.point.y : null;
  }

  /** Any static geometry inside the sphere? */
  sphereHits(center: THREE.Vector3, radius: number) {
    if (!this.bvh) return false;
    _sphere.center.copy(center);
    _sphere.radius = radius;
    return this.bvh.intersectsSphere(_sphere);
  }

  /** Is an upright capsule (feet at `pos`) free of static geometry and solid boxes? */
  capsuleFree(pos: THREE.Vector3, radius: number, height: number) {
    const steps = Math.max(2, Math.ceil((height - 2 * radius) / radius) + 1);
    for (let i = 0; i < steps; i++) {
      const y = pos.y + radius + ((height - 2 * radius) * i) / (steps - 1);
      _lc.set(pos.x, y, pos.z);
      if (this.sphereHits(_lc, radius * 0.95)) return false;
      for (const b of this.boxes) {
        if (!b.enabled || !b.solid) continue;
        if (sphereBoxPush(_lc, radius * 0.95, b, _push)) return false;
      }
    }
    return true;
  }

  /**
   * Push an upright capsule (feet at `pos`) out of everything it overlaps.
   * Walkable ground contacts are resolved straight up so characters never creep down slopes.
   */
  resolveCapsule(pos: THREE.Vector3, radius: number, height: number, res: MoveResult, ignore: BoxCollider | null = null) {
    const top = Math.max(radius, height - radius);
    if (this.bvh) {
      for (let iter = 0; iter < 3; iter++) {
        _seg.start.set(pos.x, pos.y + radius, pos.z);
        _seg.end.set(pos.x, pos.y + top, pos.z);
        _aabb.makeEmpty();
        _aabb.expandByPoint(_seg.start);
        _aabb.expandByPoint(_seg.end);
        _aabb.min.addScalar(-radius);
        _aabb.max.addScalar(radius);
        let moved = false;
        const sx = _seg.start.x;
        const sy = _seg.start.y;
        const sz = _seg.start.z;
        this.bvh.shapecast({
          intersectsBounds: (box) => box.intersectsBox(_aabb),
          intersectsTriangle: (tri: ExtendedTriangle, triIndex: number) => {
            const dist = tri.closestPointToSegment(_seg, _triPoint, _capPoint);
            if (dist >= radius) return false;
            const depth = radius - dist;
            _dir.copy(_capPoint).sub(_triPoint);
            tri.getNormal(_triN);
            if (_dir.lengthSq() < 1e-10) _dir.copy(_triN);
            else _dir.normalize();
            // inside the surface: get out along the face normal
            if (_dir.dot(_triN) < -0.2) return false;
            if (_dir.y > WALKABLE_Y) {
              // ground: lift vertically
              const lift = depth / _dir.y;
              _seg.start.y += lift;
              _seg.end.y += lift;
              if (!res.grounded || _dir.y > res.groundNormal.y) {
                res.groundNormal.copy(_triN.y > 0.3 ? _triN : _dir);
                res.surf = this.surfOfFace(triIndex);
              }
              res.grounded = true;
            } else {
              _seg.start.addScaledVector(_dir, depth);
              _seg.end.addScaledVector(_dir, depth);
              if (_dir.y < -0.5) res.hitCeiling = true;
              else {
                res.hitWall = true;
                res.wallNormal.copy(_dir);
              }
            }
            moved = true;
            return false;
          },
        });
        if (!moved) break;
        pos.x += _seg.start.x - sx;
        pos.y += _seg.start.y - sy;
        pos.z += _seg.start.z - sz;
      }
    }
    // dynamic boxes: approximate the capsule with stacked spheres
    for (const b of this.boxes) {
      if (!b.enabled || !b.solid || b === ignore) continue;
      const n = Math.max(2, Math.ceil((top - radius) / (radius * 1.2)) + 1);
      for (let i = 0; i < n; i++) {
        const y = pos.y + radius + ((top - radius) * i) / (n - 1);
        _lc.set(pos.x, y, pos.z);
        if (sphereBoxPush(_lc, radius, b, _push)) {
          if (_push.y > 0 && _push.y > Math.hypot(_push.x, _push.z) * 1.2) {
            pos.y += _push.y;
            res.grounded = true;
            res.groundNormal.set(0, 1, 0);
            res.surf = b.surf;
          } else {
            pos.x += _push.x;
            pos.z += _push.z;
            if (_push.y < 0) res.hitCeiling = true;
            res.hitWall = true;
            res.wallNormal.copy(_push).setY(0).normalize();
          }
        }
      }
    }
  }

  /**
   * Sweep a capsule by `delta` in small steps, resolving as it goes.
   */
  moveCapsule(pos: THREE.Vector3, radius: number, height: number, delta: THREE.Vector3, res: MoveResult, ignore: BoxCollider | null = null) {
    res.grounded = false;
    res.hitWall = false;
    res.hitCeiling = false;
    res.groundNormal.set(0, 1, 0);
    const len = delta.length();
    const steps = Math.max(1, Math.ceil(len / (radius * 0.45)));
    const inv = 1 / steps;
    for (let i = 0; i < steps; i++) {
      pos.x += delta.x * inv;
      pos.y += delta.y * inv;
      pos.z += delta.z * inv;
      this.resolveCapsule(pos, radius, height, res, ignore);
    }
  }
}

const DOWN = new THREE.Vector3(0, -1, 0);
const _rayBoxNormal = new THREE.Vector3();

/** Ray vs oriented box. Returns distance or -1. Writes the local-space hit normal to _rayBoxNormal. */
function rayBox(origin: THREE.Vector3, dir: THREE.Vector3, b: BoxCollider, maxDist: number) {
  _lo.copy(origin).applyMatrix4(b.inv);
  _m3.setFromMatrix4(b.inv);
  _ld.copy(dir).applyMatrix3(_m3);
  let tmin = 0;
  let tmax = maxDist;
  let axis = -1;
  let sign = 0;
  const o = [_lo.x, _lo.y, _lo.z];
  const d = [_ld.x, _ld.y, _ld.z];
  const h = [b.half.x, b.half.y, b.half.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < -h[i] || o[i] > h[i]) return -1;
    } else {
      let t1 = (-h[i] - o[i]) / d[i];
      let t2 = (h[i] - o[i]) / d[i];
      let s = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        s = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        axis = i;
        sign = s;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  if (axis < 0) {
    // started inside
    _rayBoxNormal.copy(_ld).negate();
    return 0;
  }
  _rayBoxNormal.set(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
  return tmin;
}

/** Sphere vs oriented box: writes the world-space push-out vector, returns true on overlap. */
function sphereBoxPush(center: THREE.Vector3, radius: number, b: BoxCollider, out: THREE.Vector3) {
  _lo.copy(center).applyMatrix4(b.inv);
  const hx = b.half.x;
  const hy = b.half.y;
  const hz = b.half.z;
  const cx = Math.max(-hx, Math.min(hx, _lo.x));
  const cy = Math.max(-hy, Math.min(hy, _lo.y));
  const cz = Math.max(-hz, Math.min(hz, _lo.z));
  let dx = _lo.x - cx;
  let dy = _lo.y - cy;
  let dz = _lo.z - cz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > radius * radius) return false;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    const k = (radius - d) / d;
    out.set(dx * k, dy * k, dz * k);
  } else {
    // centre inside the box: exit through the nearest face
    const px = hx - Math.abs(_lo.x);
    const py = hy - Math.abs(_lo.y);
    const pz = hz - Math.abs(_lo.z);
    dx = dy = dz = 0;
    if (px <= py && px <= pz) dx = (px + radius) * Math.sign(_lo.x || 1);
    else if (py <= pz) dy = (py + radius) * Math.sign(_lo.y || 1);
    else dz = (pz + radius) * Math.sign(_lo.z || 1);
    out.set(dx, dy, dz);
  }
  const mag = out.length();
  if (mag < 1e-9) return false;
  out.transformDirection(b.matrix).multiplyScalar(mag);
  return true;
}

export { rayBox, sphereBoxPush };
