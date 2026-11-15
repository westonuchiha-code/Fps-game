// The 3D view: the game's cel-shading pipeline, sky, an endless ground grid, the camera
// (fly / orbit / pan / dolly / top-down map), floating labels, a compass, and picking.
import * as THREE from 'three';
import { RenderPipeline, LAYER_FX, LAYER_WORLD } from '../render/pipeline';
import { Sky, SKIES } from '../render/sky';
import { Preview } from './previews';

const GRID_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const GRID_FRAG = /* glsl */ `
uniform vec3 uCam;
uniform float uFade;
varying vec3 vW;
float lineAA(vec2 p, float step) {
  vec2 c = p / step;
  vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
  return 1.0 - min(min(g.x, g.y), 1.0);
}
void main() {
  vec2 p = vW.xz;
  float d = length(vW - uCam);
  float fade = 1.0 - smoothstep(uFade * 0.35, uFade, d);
  // hide the 1 m lines once they get denser than a few pixels
  vec2 fw = fwidth(p);
  float px = max(fw.x, fw.y);
  float minorVis = 1.0 - smoothstep(0.08, 0.25, px);
  float majorVis = 1.0 - smoothstep(0.8, 2.5, px);
  float minor = lineAA(p, 1.0) * 0.28 * minorVis;
  float major = lineAA(p, 10.0) * 0.6 * majorVis;
  vec3 col = vec3(0.06, 0.06, 0.09);
  float a = max(minor, major);
  // axis lines: X axis (z = 0) red, Z axis (x = 0) blue
  vec2 ax = abs(p) / max(fw, vec2(1e-4));
  float axX = 1.0 - min(ax.y / 1.5, 1.0);
  float axZ = 1.0 - min(ax.x / 1.5, 1.0);
  if (axX > 0.01) { col = mix(col, vec3(0.95, 0.2, 0.2), axX); a = max(a, axX * 0.95); }
  if (axZ > 0.01) { col = mix(col, vec3(0.25, 0.5, 1.0), axZ); a = max(a, axZ * 0.95); }
  a *= fade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

export interface Hit {
  id: string | null;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _box = new THREE.Box3();
const _m = new THREE.Matrix4();

export class Viewport {
  readonly pipe: RenderPipeline;
  readonly scene = new THREE.Scene();
  /** drawn after the pipeline straight to the screen: gizmo, selection outlines (never inked or pixelated) */
  readonly overlay = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1500);
  readonly sky: Sky;
  readonly grid: THREE.Mesh;
  readonly content = new THREE.Group();
  readonly labelLayer: HTMLDivElement;
  readonly compass: HTMLCanvasElement;
  previews = new Map<string, Preview>();
  private needs = true;
  private raycaster = new THREE.Raycaster();
  private labelPool: HTMLDivElement[] = [];

  // camera state
  pos = new THREE.Vector3(18, 14, 26);
  yaw = 0.6;
  pitch = -0.42;
  topView = false;
  top = { x: 0, z: 0, h: 80 };
  flySpeed = 14;
  touchpad = false;
  gameLook = false;
  showGrid = true;
  showLabels = true;
  private keys = new Set<string>();
  private lastT = performance.now();
  /** overridable: is a keyboard-capturing element focused? */
  typing = () => false;
  onCameraChange: (() => void)[] = [];
  onFrame: ((dt: number) => void)[] = [];
  frameMs = 0;
  private frameTimes: number[] = [];
  skyName = 'dawn';
  private rect = { left: 0, top: 0, width: 1, height: 1 };

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly host: HTMLElement,
  ) {
    this.pipe = new RenderPipeline(canvas);
    this.pipe.forcedScale = 1;
    this.sky = new Sky(this.scene, SKIES.dawn);
    this.scene.add(this.content);
    this.camera.rotation.order = 'YXZ';

    const gm = new THREE.ShaderMaterial({
      vertexShader: GRID_VERT,
      fragmentShader: GRID_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -8,
      uniforms: { uCam: { value: new THREE.Vector3() }, uFade: { value: 220 } },
    });
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), gm);
    this.grid.scale.set(3000, 1, 3000);
    this.grid.layers.set(LAYER_FX);
    this.grid.renderOrder = 1;
    this.grid.frustumCulled = false;
    this.grid.raycast = () => {};
    this.scene.add(this.grid);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'vp-labels';
    host.appendChild(this.labelLayer);
    this.compass = document.createElement('canvas');
    this.compass.className = 'vp-compass';
    this.compass.width = this.compass.height = 92 * Math.min(2, window.devicePixelRatio || 1);
    this.compass.title = 'Compass: red X = east, blue Z = south, N = north (-Z)';
    host.appendChild(this.compass);

    this.raycaster.layers.enable(LAYER_FX);
    this.raycaster.layers.enable(LAYER_WORLD);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.bindCamera();
    const loop = () => {
      requestAnimationFrame(loop);
      this.tick();
    };
    requestAnimationFrame(loop);
  }

  setSky(name: string) {
    this.skyName = SKIES[name] ? name : 'dawn';
    this.sky.apply(SKIES[this.skyName]);
    this.request();
  }

  setGameLook(on: boolean) {
    this.gameLook = on;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.pipe.forcedScale = on ? Math.max(2, Math.round((window.innerHeight * dpr) / 540)) : 1;
    this.pipe.post.uniforms.uPosterize.value = on ? 40 : 0;
    this.resize();
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    const w = Math.max(2, Math.floor(r.width));
    const h = Math.max(2, Math.floor(r.height));
    this.pipe.resize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.request();
  }

  request() {
    this.needs = true;
  }

  // ---- camera ----------------------------------------------------------------------------------

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  private applyCamera() {
    const c = this.camera;
    if (this.topView) {
      c.fov = 30;
      c.position.set(this.top.x, this.top.h, this.top.z);
      c.rotation.set(-Math.PI / 2, 0, 0, 'YXZ');
      c.near = Math.max(0.5, this.top.h * 0.01);
      c.far = this.top.h + 600;
    } else {
      c.fov = 60;
      c.position.copy(this.pos);
      c.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      c.near = 0.1;
      c.far = 1500;
    }
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
  }

  /** Point on the ground the camera is looking at (used for the shadow centre and top view). */
  lookPoint(out = new THREE.Vector3()) {
    if (this.topView) return out.set(this.top.x, 0, this.top.z);
    const f = this.forward(_v2);
    if (f.y < -0.05) {
      const t = (0 - this.pos.y) / f.y;
      if (t > 0 && t < 200) return out.copy(this.pos).addScaledVector(f, t);
    }
    return out.copy(this.pos).addScaledVector(f, 20).setY(0);
  }

  setTopView(on: boolean) {
    if (on === this.topView) return;
    if (on) {
      const lp = this.lookPoint(new THREE.Vector3());
      this.top.x = lp.x;
      this.top.z = lp.z;
      this.top.h = THREE.MathUtils.clamp(this.pos.distanceTo(lp) * 2.2, 30, 400);
    } else {
      // come back looking at the same spot
      const lp = new THREE.Vector3(this.top.x, 0, this.top.z);
      const dist = THREE.MathUtils.clamp(this.top.h * 0.5, 10, 120);
      this.pitch = -0.6;
      const f = this.forward(new THREE.Vector3());
      this.pos.copy(lp).addScaledVector(f, -dist);
    }
    this.topView = on;
    this.cameraChanged();
  }

  /** Move the camera so the box fills the view. */
  frameBox(box: THREE.Box3) {
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(1, box.getSize(new THREE.Vector3()).length() / 2);
    if (this.topView) {
      this.top.x = c.x;
      this.top.z = c.z;
      this.top.h = Math.max(15, c.y + (r * 1.25) / Math.tan(THREE.MathUtils.degToRad(15)));
    } else {
      const dist = (r * 1.15) / Math.sin(THREE.MathUtils.degToRad(30));
      const f = this.forward(new THREE.Vector3());
      this.pos.copy(c).addScaledVector(f, -dist);
    }
    this.cameraChanged();
  }

  setCamera(pos: [number, number, number], yaw: number, pitch: number) {
    this.topView = false;
    this.pos.set(...pos);
    this.yaw = yaw;
    this.pitch = pitch;
    this.cameraChanged();
  }

  cameraChanged() {
    this.request();
    for (const f of this.onCameraChange) f();
  }

  private bindCamera() {
    const el = this.canvas;
    let mode: 'look' | 'orbit' | 'pan' | null = null;
    let lx = 0;
    let ly = 0;
    const pivot = new THREE.Vector3();
    let panDist = 10;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      const space = this.keys.has('Space');
      if (e.button === 2) mode = this.topView ? 'pan' : 'look';
      else if (e.button === 1 || (e.button === 0 && space)) mode = 'pan';
      else if (e.button === 0 && e.altKey) mode = this.topView ? 'pan' : 'orbit';
      else return;
      e.preventDefault();
      (el as any).__camDrag = true;
      lx = e.clientX;
      ly = e.clientY;
      const h = this.pick(e.clientX, e.clientY, { surfaces: true });
      if (mode === 'orbit') pivot.copy(h ? h.point : this.lookPoint(new THREE.Vector3()));
      panDist = h ? h.distance : this.camera.position.distanceTo(this.lookPoint(_v));
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!mode) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      if (mode === 'look') {
        this.yaw -= dx * 0.0042;
        this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0042, -1.55, 1.55);
      } else if (mode === 'orbit') {
        const off = _v.copy(this.pos).sub(pivot);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx * 0.006);
        off.applyQuaternion(q);
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).applyQuaternion(q);
        const newPitch = THREE.MathUtils.clamp(this.pitch - dy * 0.006, -1.5, 1.5);
        const q2 = new THREE.Quaternion().setFromAxisAngle(right, newPitch - this.pitch);
        off.applyQuaternion(q2);
        this.yaw -= dx * 0.006;
        this.pitch = newPitch;
        this.pos.copy(pivot).add(off);
      } else if (mode === 'pan') {
        this.panBy(dx, dy, panDist);
      }
      this.cameraChanged();
    });
    const end = (e: PointerEvent) => {
      if (!mode) return;
      mode = null;
      (el as any).__camDrag = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const pinch = e.ctrlKey;
        if (this.touchpad && !pinch) {
          // two-finger scroll pans on a touch-pad
          const h = this.pick(e.clientX, e.clientY, { surfaces: true });
          this.panBy(-e.deltaX, -e.deltaY, h ? h.distance : 20);
          this.cameraChanged();
          return;
        }
        let dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
        if (pinch) dy *= 3;
        this.dolly(e.clientX, e.clientY, dy);
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if (this.typing() || e.ctrlKey || e.metaKey) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private panBy(dx: number, dy: number, dist: number) {
    if (this.topView) {
      const s = (2 * this.top.h * Math.tan(THREE.MathUtils.degToRad(15))) / this.rect.height;
      this.top.x -= dx * s;
      this.top.z -= dy * s;
      return;
    }
    const s = (2 * Math.max(1, dist) * Math.tan(THREE.MathUtils.degToRad(30))) / this.rect.height;
    const right = _v.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const up = _v2.set(0, 1, 0);
    // camera-up (perpendicular to the view)
    const f = this.forward(new THREE.Vector3());
    up.crossVectors(right, f).normalize();
    this.pos.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
  }

  /** Dolly towards the point under the cursor. */
  dolly(cx: number, cy: number, delta: number) {
    const k = THREE.MathUtils.clamp(delta / 500, -0.5, 0.5);
    if (this.topView) {
      const before = this.groundAt(cx, cy);
      this.top.h = THREE.MathUtils.clamp(this.top.h * (1 + k), 8, 900);
      this.applyCamera();
      const after = this.groundAt(cx, cy);
      if (before && after) {
        this.top.x += before.x - after.x;
        this.top.z += before.z - after.z;
      }
    } else {
      const h = this.pick(cx, cy, { surfaces: true });
      const dist = h ? h.distance : 30;
      const dir = this.rayDir(cx, cy, new THREE.Vector3());
      const step = -k * Math.max(0.6, dist);
      this.pos.addScaledVector(dir, Math.min(step, dist - 0.5));
    }
    this.cameraChanged();
  }

  private updateFly(dt: number) {
    if (this.typing()) return false;
    const k = this.keys;
    let mx = 0;
    let my = 0;
    let mz = 0;
    if (k.has('KeyW')) mz += 1;
    if (k.has('KeyS')) mz -= 1;
    if (k.has('KeyD')) mx += 1;
    if (k.has('KeyA')) mx -= 1;
    if (k.has('KeyE')) my += 1;
    if (k.has('KeyQ')) my -= 1;
    if (!mx && !my && !mz) return false;
    const fast = k.has('ShiftLeft') || k.has('ShiftRight') ? 3.5 : 1;
    if (this.topView) {
      const s = this.top.h * 0.9 * dt * fast;
      this.top.x += mx * s;
      this.top.z -= mz * s;
      this.top.h = THREE.MathUtils.clamp(this.top.h - my * s, 8, 900);
    } else {
      const sp = this.flySpeed * dt * fast;
      const f = this.forward(new THREE.Vector3());
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      this.pos.addScaledVector(f, mz * sp).addScaledVector(right, mx * sp);
      this.pos.y += my * sp;
    }
    this.cameraChanged();
    return true;
  }

  // ---- picking ---------------------------------------------------------------------------------

  updateRect() {
    const r = this.canvas.getBoundingClientRect();
    this.rect = { left: r.left, top: r.top, width: Math.max(1, r.width), height: Math.max(1, r.height) };
  }

  ndc(cx: number, cy: number, out = new THREE.Vector2()) {
    this.updateRect();
    return out.set(((cx - this.rect.left) / this.rect.width) * 2 - 1, -((cy - this.rect.top) / this.rect.height) * 2 + 1);
  }

  rayDir(cx: number, cy: number, out: THREE.Vector3) {
    this.applyCamera();
    this.raycaster.setFromCamera(this.ndc(cx, cy), this.camera);
    return out.copy(this.raycaster.ray.direction);
  }

  /** Intersection with the y = h plane. */
  groundAt(cx: number, cy: number, h = 0) {
    this.applyCamera();
    this.raycaster.setFromCamera(this.ndc(cx, cy), this.camera);
    const r = this.raycaster.ray;
    if (Math.abs(r.direction.y) < 1e-5) return null;
    const t = (h - r.origin.y) / r.direction.y;
    if (t <= 0 || t > 5000) return null;
    return r.origin.clone().addScaledVector(r.direction, t);
  }

  /**
   * What is under the cursor. `surfaces`: only things you can stand on (and the ground plane).
   * `exclude`: ids to ignore. Volumes only win when you click inside nothing else.
   */
  pick(cx: number, cy: number, opts: { surfaces?: boolean; exclude?: Set<string>; includeLocked?: boolean; locked?: Set<string> } = {}): Hit | null {
    this.applyCamera();
    this.raycaster.setFromCamera(this.ndc(cx, cy), this.camera);
    return this.castRay(this.raycaster.ray, opts);
  }

  castRay(ray: THREE.Ray, opts: { surfaces?: boolean; exclude?: Set<string>; locked?: Set<string>; maxDist?: number } = {}): Hit | null {
    this.raycaster.ray.copy(ray);
    this.raycaster.near = 0;
    this.raycaster.far = opts.maxDist ?? 5000;
    const roots: THREE.Object3D[] = [];
    for (const p of this.previews.values()) {
      if (p.hidden || !p.root.parent) continue;
      if (opts.exclude?.has(p.id)) continue;
      if (opts.locked?.has(p.id)) continue;
      if (opts.surfaces && !p.solid) continue;
      roots.push(p.body);
    }
    const hits = this.raycaster.intersectObjects(roots, true);
    let solid: THREE.Intersection | null = null;
    let vol: THREE.Intersection | null = null;
    for (const h of hits) {
      const id = h.object.userData.pid as string;
      const p = this.previews.get(id);
      if (!p) continue;
      if (p.isVolume) {
        if (!vol && !this.insideVolume(p, ray.origin)) vol = h;
      } else if (!solid) solid = h;
      if (solid && vol) break;
    }
    let best = solid;
    if (vol && (!solid || (vol.distance < solid.distance && !this.insideVolume(this.previews.get(vol.object.userData.pid)!, solid.point, 0.05)))) best = vol;
    if (best) {
      const n = best.face ? best.face.normal.clone().transformDirection(best.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      return { id: best.object.userData.pid, point: best.point.clone(), normal: n, distance: best.distance };
    }
    // ground plane fallback (only for surface queries)
    if (opts.surfaces && Math.abs(ray.direction.y) > 1e-5) {
      const t = -ray.origin.y / ray.direction.y;
      if (t > 0 && t < (opts.maxDist ?? 5000)) return { id: null, point: ray.origin.clone().addScaledVector(ray.direction, t), normal: new THREE.Vector3(0, 1, 0), distance: t };
    }
    return null;
  }

  private insideVolume(p: Preview, pt: THREE.Vector3, shrink = 0) {
    _m.copy(p.root.matrixWorld).invert();
    _v.copy(pt).applyMatrix4(_m);
    _box.copy(p.bbox).expandByScalar(-shrink);
    return _box.containsPoint(_v);
  }

  /** Surface straight below a point (for "drop to floor" and play-from-here). */
  surfaceBelow(p: THREE.Vector3, exclude?: Set<string>) {
    const ray = new THREE.Ray(p.clone(), new THREE.Vector3(0, -1, 0));
    return this.castRay(ray, { surfaces: true, exclude, maxDist: 2000 });
  }

  /** Screen position (client px) of a world point, or null when behind the camera. */
  toScreen(p: THREE.Vector3) {
    this.applyCamera();
    this.updateRect();
    _v.copy(p).project(this.camera);
    if (_v.z > 1 || _v.z < -1) return null;
    return { x: this.rect.left + ((_v.x + 1) / 2) * this.rect.width, y: this.rect.top + ((1 - _v.y) / 2) * this.rect.height };
  }

  // ---- frame -----------------------------------------------------------------------------------

  private tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    const flying = this.updateFly(dt);
    for (const f of this.onFrame) f(dt);
    if (!this.needs && !flying) return;
    this.needs = false;
    this.renderNow();
  }

  renderNow() {
    const t0 = performance.now();
    this.applyCamera();
    this.updateRect();
    const lp = this.lookPoint(new THREE.Vector3());
    this.sky.shadowRange = this.topView ? Math.min(220, this.top.h * 0.6) : 46;
    this.sky.update(lp, 0);
    this.sky.mesh.position.copy(this.camera.position);
    this.sky.fog.density = this.topView ? 0 : (SKIES[this.skyName] ?? SKIES.dawn).fogDensity;
    const gu = (this.grid.material as THREE.ShaderMaterial).uniforms;
    (gu.uCam.value as THREE.Vector3).copy(this.camera.position);
    gu.uFade.value = this.topView ? this.top.h * 3 : 120 + this.camera.position.y * 3;
    this.grid.visible = this.showGrid;
    this.pipe.render(this.scene, this.camera, { viewFov: 50, drawView: false });
    // crisp overlay: gizmo and outlines straight onto the screen
    const r = this.pipe.renderer;
    r.setRenderTarget(null);
    const vpW = r.domElement.width;
    const vpH = r.domElement.height;
    r.setViewport(0, 0, vpW, vpH);
    r.render(this.overlay, this.camera);
    this.updateLabels();
    this.drawCompass();
    const ms = performance.now() - t0;
    this.frameTimes.push(ms);
    if (this.frameTimes.length > 30) this.frameTimes.shift();
    this.frameMs = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
  }

  // ---- labels ----------------------------------------------------------------------------------

  private updateLabels() {
    const show = this.showLabels;
    const cam = this.camera.position;
    const maxD = this.topView ? this.top.h * 3 : 70;
    const items: { p: Preview; d: number; w: THREE.Vector3 }[] = [];
    if (show) {
      for (const p of this.previews.values()) {
        if (!p.label || p.hidden || !p.root.parent) continue;
        // labels float straight above the object's origin
        const w = new THREE.Vector3(p.root.position.x, p.root.position.y + p.labelY * p.root.scale.x, p.root.position.z);
        const d = w.distanceTo(cam);
        if (d > maxD) continue;
        items.push({ p, d, w });
      }
      // selected first, then nearest
      items.sort((a, b) => (b.p.root.userData.selected ? 1 : 0) - (a.p.root.userData.selected ? 1 : 0) || a.d - b.d);
      items.length = Math.min(items.length, this.topView ? 160 : 90);
    }
    let i = 0;
    const W = this.rect.width;
    const H = this.rect.height;
    // greedy declutter: a label that would cover one already shown is skipped
    const taken: number[][] = [];
    const subsOK = !this.topView || this.top.h < 45;
    for (const it of items) {
      _v.copy(it.w).project(this.camera);
      if (_v.z > 1 || _v.x < -1.1 || _v.x > 1.1 || _v.y < -1.1 || _v.y > 1.1) continue;
      const sx = ((_v.x + 1) / 2) * W;
      const sy = ((1 - _v.y) / 2) * H;
      const withSub = !!it.p.sub && subsOK && it.d < maxD * 0.5;
      const lw = it.p.label.length * 7 + 14;
      const lh = withSub ? 30 : 17;
      const box = [sx - lw / 2, sy - lh, sx + lw / 2, sy];
      if (!it.p.root.userData.selected && taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) continue;
      taken.push(box);
      let el = this.labelPool[i];
      if (!el) {
        el = document.createElement('div');
        el.className = 'vp-label';
        el.innerHTML = '<b></b><i></i>';
        this.labelLayer.appendChild(el);
        this.labelPool[i] = el;
      }
      i++;
      const b = el.firstChild as HTMLElement;
      const s = el.lastChild as HTMLElement;
      if (b.textContent !== it.p.label) b.textContent = it.p.label;
      if (s.textContent !== it.p.sub) s.textContent = it.p.sub;
      s.style.display = withSub ? '' : 'none';
      el.style.setProperty('--c', it.p.labelColor);
      el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
      el.style.opacity = String(THREE.MathUtils.clamp(1.4 - it.d / maxD, 0.35, 1));
      el.style.display = '';
      el.classList.toggle('picked', !!it.p.root.userData.selected);
    }
    for (; i < this.labelPool.length; i++) this.labelPool[i].style.display = 'none';
  }

  private drawCompass() {
    const c = this.compass;
    const g = c.getContext('2d')!;
    const S = c.width;
    g.clearRect(0, 0, S, S);
    const cx = S / 2;
    const cy = S / 2;
    const R = S * 0.36;
    g.fillStyle = 'rgba(11,11,18,0.72)';
    g.beginPath();
    g.arc(cx, cy, S * 0.47, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ffd21f';
    g.lineWidth = S / 46;
    g.stroke();
    const q = this.camera.quaternion.clone().invert();
    const axes: [THREE.Vector3, string, string][] = [
      [new THREE.Vector3(1, 0, 0), '#ff4d4d', 'X'],
      [new THREE.Vector3(0, 1, 0), '#4ddc6a', 'Y'],
      [new THREE.Vector3(0, 0, 1), '#5a8dff', 'Z'],
      [new THREE.Vector3(0, 0, -1), '#ffd21f', 'N'],
    ];
    const proj = axes.map(([v, col, l]) => ({ v: v.clone().applyQuaternion(q), col, l }));
    proj.sort((a, b) => a.v.z - b.v.z);
    g.font = `700 ${Math.round(S * 0.15)}px Rajdhani, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of proj) {
      const x = cx + p.v.x * R;
      const y = cy - p.v.y * R;
      if (p.l !== 'N') {
        g.strokeStyle = p.col;
        g.lineWidth = S / 30;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + p.v.x * R * 0.78, cy - p.v.y * R * 0.78);
        g.stroke();
      }
      g.fillStyle = p.col;
      g.beginPath();
      g.arc(x, y, S * 0.085, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#0b0b12';
      g.fillText(p.l, x, y + 1);
    }
  }

  stats() {
    return { frameMs: +this.frameMs.toFixed(2), calls: this.pipe.renderer.info.render.calls, tris: this.pipe.renderer.info.render.triangles };
  }
}
