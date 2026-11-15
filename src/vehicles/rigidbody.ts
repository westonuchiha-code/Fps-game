import * as THREE from 'three';

const _v = new THREE.Vector3();
const _r = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const _qw = new THREE.Quaternion();

/**
 * Minimal 6-DOF rigid body (no physics library): semi-implicit Euler, diagonal box inertia,
 * world-space angular velocity. Forces accumulate until `integrate()`.
 */
export class RigidBody {
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly vel = new THREE.Vector3();
  /** world-space angular velocity, rad/s */
  readonly angVel = new THREE.Vector3();
  readonly force = new THREE.Vector3();
  readonly torque = new THREE.Vector3();
  mass: number;
  invMass: number;
  /** inverse of the principal moments (body space) */
  readonly invInertia = new THREE.Vector3();
  readonly inertia = new THREE.Vector3();
  gravity = 9.81;
  linearDamping = 0.02;
  angularDamping = 0.6;
  /** hard caps keep a bad frame from ever producing NaN/infinity */
  maxSpeed = 70;
  maxSpin = 14;

  /** `w,h,d` are the box the inertia is approximated with. */
  constructor(mass: number, w: number, h: number, d: number) {
    this.mass = mass;
    this.invMass = 1 / mass;
    const k = mass / 12;
    this.inertia.set(k * (h * h + d * d), k * (w * w + d * d), k * (w * w + h * h));
    this.invInertia.set(1 / this.inertia.x, 1 / this.inertia.y, 1 / this.inertia.z);
  }

  /** out = I⁻¹ · v with v and out in world space. */
  applyInvInertia(v: THREE.Vector3, out: THREE.Vector3) {
    _qi.copy(this.quat).invert();
    out.copy(v).applyQuaternion(_qi);
    out.x *= this.invInertia.x;
    out.y *= this.invInertia.y;
    out.z *= this.invInertia.z;
    return out.applyQuaternion(this.quat);
  }

  /** Velocity of a world-space point rigidly attached to the body. */
  pointVelocity(p: THREE.Vector3, out: THREE.Vector3) {
    _r.copy(p).sub(this.pos);
    return out.crossVectors(this.angVel, _r).add(this.vel);
  }

  applyForce(f: THREE.Vector3) {
    this.force.add(f);
  }
  applyForceAt(f: THREE.Vector3, p: THREE.Vector3) {
    this.force.add(f);
    _r.copy(p).sub(this.pos);
    this.torque.add(_v.crossVectors(_r, f));
  }
  applyTorque(t: THREE.Vector3) {
    this.torque.add(t);
  }
  applyImpulse(j: THREE.Vector3) {
    this.vel.addScaledVector(j, this.invMass);
  }
  applyImpulseAt(j: THREE.Vector3, p: THREE.Vector3) {
    this.vel.addScaledVector(j, this.invMass);
    _r.copy(p).sub(this.pos);
    _v.crossVectors(_r, j);
    this.applyInvInertia(_v, _v);
    this.angVel.add(_v);
  }

  /** Effective inverse mass along `n` for an impulse at world point `p`. */
  invMassAt(p: THREE.Vector3, n: THREE.Vector3) {
    _r.copy(p).sub(this.pos);
    _v.crossVectors(_r, n);
    this.applyInvInertia(_v, _v);
    _v.cross(_r);
    return this.invMass + n.dot(_v);
  }

  localToWorld(local: THREE.Vector3, out: THREE.Vector3) {
    return out.copy(local).applyQuaternion(this.quat).add(this.pos);
  }
  dirToWorld(local: THREE.Vector3, out: THREE.Vector3) {
    return out.copy(local).applyQuaternion(this.quat);
  }
  worldToLocal(world: THREE.Vector3, out: THREE.Vector3) {
    _qi.copy(this.quat).invert();
    return out.copy(world).sub(this.pos).applyQuaternion(_qi);
  }

  integrate(h: number) {
    // linear
    this.vel.addScaledVector(this.force, this.invMass * h);
    this.vel.y -= this.gravity * h;
    this.vel.multiplyScalar(1 / (1 + this.linearDamping * h));
    // angular (gyroscopic term ignored: stable and good enough for vehicles)
    this.applyInvInertia(this.torque, _v);
    this.angVel.addScaledVector(_v, h);
    this.angVel.multiplyScalar(1 / (1 + this.angularDamping * h));
    // safety
    const sp = this.vel.length();
    if (sp > this.maxSpeed) this.vel.multiplyScalar(this.maxSpeed / sp);
    const w = this.angVel.length();
    if (w > this.maxSpin) this.angVel.multiplyScalar(this.maxSpin / w);
    if (!Number.isFinite(sp) || !Number.isFinite(w)) {
      this.vel.set(0, 0, 0);
      this.angVel.set(0, 0, 0);
    }
    this.pos.addScaledVector(this.vel, h);
    // q += ½ h ω q
    _qw.set(this.angVel.x, this.angVel.y, this.angVel.z, 0).multiply(this.quat);
    this.quat.x += 0.5 * h * _qw.x;
    this.quat.y += 0.5 * h * _qw.y;
    this.quat.z += 0.5 * h * _qw.z;
    this.quat.w += 0.5 * h * _qw.w;
    this.quat.normalize();
    if (!Number.isFinite(this.quat.w)) this.quat.identity();
    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
  }
}
