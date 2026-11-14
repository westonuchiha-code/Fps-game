import * as THREE from 'three';
import { LAYER_FX } from './pipeline';

export interface SkyPreset {
  zenith: number;
  mid: number;
  horizon: number;
  sun: number;
  sunDir: THREE.Vector3;
  cloud: number;
  cloudShade: number;
  cloudCover: number;
  fog: number;
  fogDensity: number;
  sunIntensity: number;
  sunColor: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
}

export const SKY_DAWN: SkyPreset = {
  zenith: 0x2f6f9a,
  mid: 0x7fb3b0,
  horizon: 0xf6b36a,
  sun: 0xfff3c2,
  sunDir: new THREE.Vector3(0.55, 0.42, 0.72).normalize(),
  cloud: 0xffe2b8,
  cloudShade: 0xd9897a,
  cloudCover: 0.5,
  fog: 0xeab98a,
  fogDensity: 0.0052,
  sunIntensity: 2.75,
  sunColor: 0xfff0d6,
  hemiSky: 0x8fa3ea,
  hemiGround: 0xc98a5a,
  hemiIntensity: 1.2,
};

export const SKY_NOON: SkyPreset = {
  zenith: 0x2b7fd0,
  mid: 0x6fb6e6,
  horizon: 0xcfe6ee,
  sun: 0xffffff,
  sunDir: new THREE.Vector3(0.35, 0.86, 0.36).normalize(),
  cloud: 0xffffff,
  cloudShade: 0xb8cbe0,
  cloudCover: 0.42,
  fog: 0xc9dde6,
  fogDensity: 0.0042,
  sunIntensity: 2.9,
  sunColor: 0xfffaf0,
  hemiSky: 0xa9c6f2,
  hemiGround: 0xb9a37c,
  hemiIntensity: 1.3,
};

export const SKY_DUSK: SkyPreset = {
  zenith: 0x2a2f6e,
  mid: 0x8a4f8f,
  horizon: 0xff8a4a,
  sun: 0xffd9a0,
  sunDir: new THREE.Vector3(-0.72, 0.2, -0.66).normalize(),
  cloud: 0xffb07a,
  cloudShade: 0x8a4a78,
  cloudCover: 0.55,
  fog: 0xd98a6a,
  fogDensity: 0.006,
  sunIntensity: 2.5,
  sunColor: 0xffc890,
  hemiSky: 0x7a6fd0,
  hemiGround: 0xa5603c,
  hemiIntensity: 1.15,
};

export const SKY_NIGHT: SkyPreset = {
  zenith: 0x0b1030,
  mid: 0x1b2a58,
  horizon: 0x34508a,
  sun: 0xe8f0ff,
  sunDir: new THREE.Vector3(0.4, 0.62, -0.67).normalize(),
  cloud: 0x3a4f86,
  cloudShade: 0x1c274f,
  cloudCover: 0.4,
  fog: 0x1e2c52,
  fogDensity: 0.0075,
  sunIntensity: 1.5,
  sunColor: 0xa9c0ff,
  hemiSky: 0x4a5fb0,
  hemiGround: 0x2a2f4a,
  hemiIntensity: 1.15,
};

export const SKIES: Record<string, SkyPreset> = { dawn: SKY_DAWN, noon: SKY_NOON, dusk: SKY_DUSK, night: SKY_NIGHT };

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = modelViewMatrix * vec4(position, 0.0);
  gl_Position = projectionMatrix * vec4(p.xyz, 1.0);
  gl_Position.z = gl_Position.w; // pin to the far plane
}`;

const FRAG = /* glsl */ `
uniform vec3 uZenith; uniform vec3 uMid; uniform vec3 uHorizon;
uniform vec3 uSun; uniform vec3 uSunDir;
uniform vec3 uCloud; uniform vec3 uCloudShade; uniform float uCover;
uniform float uTime;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  // banded gradient: a few flat steps reads as painted rather than photographic
  float t = clamp(h, 0.0, 1.0);
  float tb = floor(pow(t, 0.55) * 7.0 + 0.5) / 7.0;
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.32, tb));
  col = mix(col, uZenith, smoothstep(0.25, 0.95, tb));
  col = mix(col, uHorizon * 0.82, smoothstep(0.0, -0.25, h));

  // sun: hard disc + two flat halo rings
  float sd = dot(d, normalize(uSunDir));
  col = mix(col, uSun, step(0.9965, sd));
  col += uSun * 0.16 * step(0.985, sd) * (1.0 - step(0.9965, sd));
  col += uSun * 0.07 * step(0.94, sd) * (1.0 - step(0.985, sd));

  // cel clouds: thresholded noise projected onto a flat layer, two tones
  if (h > 0.02) {
    vec2 uv = d.xz / (h + 0.12) * 0.55 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(uv * 1.4);
    float c = step(1.0 - uCover * 0.62, n + 0.12 * fbm(uv * 5.0));
    float shade = step(1.0 - uCover * 0.62 + 0.07, fbm(uv * 1.4 + vec2(0.05, 0.11)) + 0.12 * fbm(uv * 5.0));
    vec3 cc = mix(uCloudShade, uCloud, shade);
    float fade = smoothstep(0.02, 0.2, h);
    col = mix(col, cc, c * fade * 0.92);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.FogExp2;
  private mat: THREE.ShaderMaterial;
  private sunDir = new THREE.Vector3();
  /** half-size of the square the sun shadow covers around the camera */
  shadowRange = 46;

  constructor(scene: THREE.Scene, preset: SkyPreset, shadowSize = 2048) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uMid: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSun: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3() },
        uCloud: { value: new THREE.Color() },
        uCloudShade: { value: new THREE.Color() },
        uCover: { value: 0.5 },
        uTime: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.layers.set(LAYER_FX);
    scene.add(this.mesh);

    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.035;
    this.sun.layers.enableAll();
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
    this.hemi.layers.enableAll();
    scene.add(this.hemi);
    this.fog = new THREE.FogExp2(0xffffff, 0.005);
    scene.fog = this.fog;
    this.apply(preset);
  }

  apply(p: SkyPreset) {
    const u = this.mat.uniforms;
    (u.uZenith.value as THREE.Color).setHex(p.zenith);
    (u.uMid.value as THREE.Color).setHex(p.mid);
    (u.uHorizon.value as THREE.Color).setHex(p.horizon);
    (u.uSun.value as THREE.Color).setHex(p.sun);
    (u.uSunDir.value as THREE.Vector3).copy(p.sunDir);
    (u.uCloud.value as THREE.Color).setHex(p.cloud);
    (u.uCloudShade.value as THREE.Color).setHex(p.cloudShade);
    u.uCover.value = p.cloudCover;
    this.sunDir.copy(p.sunDir).normalize();
    this.sun.color.setHex(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.hemi.color.setHex(p.hemiSky);
    this.hemi.groundColor.setHex(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.fog.color.setHex(p.fog);
    this.fog.density = p.fogDensity;
  }

  /** Keep the dome and the shadow frustum centred on the camera (snapped to shadow texels to stop shimmer). */
  update(camPos: THREE.Vector3, time: number) {
    this.mat.uniforms.uTime.value = time;
    this.mesh.position.copy(camPos);
    const r = this.shadowRange;
    const cam = this.sun.shadow.camera;
    if (cam.right !== r) {
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.near = 1;
      cam.far = 260;
      cam.updateProjectionMatrix();
    }
    const texel = (2 * r) / this.sun.shadow.mapSize.x;
    const sx = Math.round(camPos.x / texel) * texel;
    const sy = Math.round(camPos.y / texel) * texel;
    const sz = Math.round(camPos.z / texel) * texel;
    this.sun.target.position.set(sx, sy, sz);
    this.sun.position.set(sx, sy, sz).addScaledVector(this.sunDir, 120);
    this.sun.target.updateMatrixWorld();
  }

  get sunDirection() {
    return this.sunDir;
  }
}
