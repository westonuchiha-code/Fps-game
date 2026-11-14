import * as THREE from 'three';

/**
 * Render layers.
 *  WORLD - everything that gets ink outlines (level, characters, vehicles, props)
 *  VIEW  - first-person arms + weapon; drawn after the world with its own FOV and a cleared depth buffer
 *  FX    - particles, glows, sky, beams: colour only, never inked
 */
export const LAYER_WORLD = 0;
export const LAYER_VIEW = 1;
export const LAYER_FX = 2;

const NORMAL_VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying vec3 vN;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vN = normalize(transformedNormal);
}`;

const NORMAL_FRAG = /* glsl */ `
uniform float uFlag;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  gl_FragColor = vec4(n * 0.5 + 0.5, uFlag);
}`;

const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const POST_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform vec2 uSize;        // internal resolution in pixels
uniform vec4 uProj;        // world near, world far, view near, view far
uniform vec3 uInk;
uniform float uInkStrength;
uniform float uFogDensity;
uniform float uVignette;
uniform vec3 uFlashColor;  // full-screen tint (damage / pickup / fade)
uniform float uFlash;
uniform vec3 uEdgeColor;   // screen-edge vignette tint (damage direction-less pulse)
uniform float uEdge;
uniform float uFade;       // 0 = normal, 1 = black
uniform float uDesat;
uniform float uPosterize;  // 0 = off, else number of levels
uniform float uTime;
varying vec2 vUv;

float viewZ(float d, float n, float f) { return (n * f) / (f - d * (f - n)); }

float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int idx = i.x + i.y * 4;
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return m[idx] / 16.0 - 0.5;
}

void main() {
  // Snap to the centre of the low-res texel so the up-scale is a clean integer blow-up.
  vec2 px = floor(vUv * uSize);
  vec2 uv = (px + 0.5) / uSize;
  vec2 t = 1.0 / uSize;

  vec3 col = texture2D(tColor, uv).rgb;

  vec4 nC = texture2D(tNormal, uv);
  vec4 nL = texture2D(tNormal, uv - vec2(t.x, 0.0));
  vec4 nR = texture2D(tNormal, uv + vec2(t.x, 0.0));
  vec4 nU = texture2D(tNormal, uv + vec2(0.0, t.y));
  vec4 nD = texture2D(tNormal, uv - vec2(0.0, t.y));
  float dC = texture2D(tDepth, uv).x;
  float dL = texture2D(tDepth, uv - vec2(t.x, 0.0)).x;
  float dR = texture2D(tDepth, uv + vec2(t.x, 0.0)).x;
  float dU = texture2D(tDepth, uv + vec2(0.0, t.y)).x;
  float dD = texture2D(tDepth, uv - vec2(0.0, t.y)).x;

  bool isView = nC.a > 0.25 && nC.a < 0.75;
  bool isSky = nC.a < 0.25;
  float n = isView ? uProj.z : uProj.x;
  float f = isView ? uProj.w : uProj.y;
  float zC = viewZ(dC, n, f);

  // Depth edge: second derivative of raw depth is ~0 on any flat surface, however steeply it is
  // viewed, so floors seen at grazing angles do not turn black.
  float lap = abs(dL + dR - 2.0 * dC) + abs(dU + dD - 2.0 * dC);
  float rel = lap * zC * (f - n) / (f * n);
  float eDepth = smoothstep(0.012, 0.035, rel);

  // Normal edge (creases between flat faces).
  vec3 N = nC.xyz * 2.0 - 1.0;
  float nd = 0.0;
  nd += 1.0 - dot(N, nL.xyz * 2.0 - 1.0);
  nd += 1.0 - dot(N, nR.xyz * 2.0 - 1.0);
  nd += 1.0 - dot(N, nU.xyz * 2.0 - 1.0);
  nd += 1.0 - dot(N, nD.xyz * 2.0 - 1.0);
  float eNormal = smoothstep(0.28, 0.6, nd);
  // interior crease lines thin out with distance so far geometry does not turn into black noise
  if (!isView) eNormal *= 1.0 - smoothstep(22.0, 60.0, zC);

  // Silhouette between categories (gun vs world, anything vs sky). Only draw on the nearer side.
  float aMin = min(min(nL.a, nR.a), min(nU.a, nD.a));
  float aMax = max(max(nL.a, nR.a), max(nU.a, nD.a));
  float eFlag = (aMax - aMin > 0.2 && !isSky) ? 1.0 : 0.0;

  float edge = max(max(eDepth, eNormal), eFlag);
  if (isSky) edge = 0.0;

  // Ink fades into the fog with distance.
  float fog = isView ? 0.0 : 1.0 - exp(-uFogDensity * uFogDensity * zC * zC);
  edge *= uInkStrength * (1.0 - fog * 0.85);
  col = mix(col, uInk, edge);

  // --- screen effects ---
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum), uDesat);

  vec2 q = vUv - 0.5;
  float vig = smoothstep(0.35, 0.95, length(q * vec2(1.0, 0.85)) * 1.25);
  col *= 1.0 - vig * uVignette;
  col = mix(col, uEdgeColor, vig * uEdge);
  col = mix(col, uFlashColor, uFlash);

  if (uPosterize > 0.5) {
    // gentle ordered dither in display space, PS2 flavoured
    vec3 s = pow(max(col, 0.0), vec3(1.0 / 2.2));
    s = floor(s * uPosterize + 0.5 + bayer4(px) * 0.9) / uPosterize;
    col = pow(clamp(s, 0.0, 1.0), vec3(2.2));
  }

  col *= 1.0 - uFade;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export interface RenderOptions {
  /** vertical FOV used for the first-person viewmodel pass */
  viewFov: number;
  drawView: boolean;
}

export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  readonly post: THREE.ShaderMaterial;
  /** Target internal height; the real one is the display height divided by a whole number. */
  targetHeight = 540;
  /** 0 = auto integer scale towards targetHeight, otherwise forced divisor (1 = native). */
  forcedScale = 0;
  pixelScale = 1;
  width = 1;
  height = 1;

  private colorRT: THREE.WebGLRenderTarget;
  private normalRT: THREE.WebGLRenderTarget;
  private normalWorld: THREE.ShaderMaterial;
  private normalView: THREE.ShaderMaterial;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private savedProj = new THREE.Matrix4();
  private savedProjInv = new THREE.Matrix4();
  private viewCam = new THREE.PerspectiveCamera();
  readonly viewNear = 0.02;
  readonly viewFar = 12;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.info.autoReset = false;

    const mkRT = (type: THREE.TextureDataType) => {
      const rt = new THREE.WebGLRenderTarget(4, 4, {
        type,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: true,
        stencilBuffer: false,
        generateMipmaps: false,
      });
      rt.depthTexture = new THREE.DepthTexture(4, 4);
      rt.depthTexture.type = THREE.FloatType;
      rt.depthTexture.minFilter = THREE.NearestFilter;
      rt.depthTexture.magFilter = THREE.NearestFilter;
      return rt;
    };
    this.colorRT = mkRT(THREE.HalfFloatType);
    this.normalRT = mkRT(THREE.UnsignedByteType);

    const mkNormal = (flag: number) =>
      new THREE.ShaderMaterial({
        vertexShader: NORMAL_VERT,
        fragmentShader: NORMAL_FRAG,
        uniforms: { uFlag: { value: flag } },
        side: THREE.DoubleSide,
      });
    this.normalWorld = mkNormal(1.0);
    this.normalView = mkNormal(0.5);

    this.post = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.colorRT.texture },
        tNormal: { value: this.normalRT.texture },
        tDepth: { value: this.normalRT.depthTexture },
        uSize: { value: new THREE.Vector2(4, 4) },
        uProj: { value: new THREE.Vector4(0.1, 1000, this.viewNear, this.viewFar) },
        uInk: { value: new THREE.Color(0x0b0b12) },
        uInkStrength: { value: 0.92 },
        uFogDensity: { value: 0.004 },
        uVignette: { value: 0.28 },
        uFlashColor: { value: new THREE.Color(1, 1, 1) },
        uFlash: { value: 0 },
        uEdgeColor: { value: new THREE.Color(0.9, 0.05, 0.05) },
        uEdge: { value: 0 },
        uFade: { value: 0 },
        uDesat: { value: 0 },
        uPosterize: { value: 0 },
        uTime: { value: 0 },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post);
    quad.frustumCulled = false;
    this.postScene.add(quad);
  }

  /** Call when the canvas CSS size changes. */
  resize(cssW: number, cssH: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.max(2, Math.floor(cssW * dpr));
    const bh = Math.max(2, Math.floor(cssH * dpr));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(bw, bh, false);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.pixelScale = this.forcedScale > 0 ? this.forcedScale : Math.max(1, Math.round(bh / this.targetHeight));
    this.width = Math.max(2, Math.floor(bw / this.pixelScale));
    this.height = Math.max(2, Math.floor(bh / this.pixelScale));
    this.colorRT.setSize(this.width, this.height);
    this.normalRT.setSize(this.width, this.height);
    (this.post.uniforms.uSize.value as THREE.Vector2).set(this.width, this.height);
  }

  get aspect() {
    return this.width / this.height;
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, opts: RenderOptions) {
    const r = this.renderer;
    r.info.reset();
    const u = this.post.uniforms;
    (u.uProj.value as THREE.Vector4).set(camera.near, camera.far, this.viewNear, this.viewFar);
    const fog = scene.fog as THREE.FogExp2 | null;
    u.uFogDensity.value = fog && (fog as THREE.FogExp2).isFogExp2 ? fog.density : 0;

    const vc = this.viewCam;
    if (opts.drawView) {
      // Same pose as the main camera, narrower FOV and tight clip planes.
      camera.updateMatrixWorld();
      vc.matrixWorld.copy(camera.matrixWorld);
      vc.matrixWorldInverse.copy(camera.matrixWorldInverse);
      vc.matrixAutoUpdate = false;
      vc.matrixWorldAutoUpdate = false;
      vc.fov = opts.viewFov;
      vc.aspect = camera.aspect;
      vc.near = this.viewNear;
      vc.far = this.viewFar;
      vc.updateProjectionMatrix();
      vc.layers.set(LAYER_VIEW);
    }

    // ---- colour ----
    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.colorRT);
    r.setClearColor(fog ? fog.color : 0x000000, 1);
    r.clear(true, true, false);
    camera.layers.set(LAYER_WORLD);
    camera.layers.enable(LAYER_FX);
    r.render(scene, camera);
    if (opts.drawView) {
      r.clearDepth();
      r.render(scene, vc);
    }

    // ---- normals + depth for the ink pass ----
    r.setRenderTarget(this.normalRT);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    camera.layers.set(LAYER_WORLD);
    scene.overrideMaterial = this.normalWorld;
    r.render(scene, camera);
    if (opts.drawView) {
      r.clearDepth();
      scene.overrideMaterial = this.normalView;
      r.render(scene, vc);
    }
    scene.overrideMaterial = null;
    camera.layers.set(LAYER_WORLD);
    camera.layers.enable(LAYER_FX);

    // ---- composite to screen ----
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCam);
  }
}
