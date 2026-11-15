// Left panel: everything you can place, by tab and category, with little rendered thumbnails.
import * as THREE from 'three';
import { RenderPipeline } from '../render/pipeline';
import { PALETTE, PALETTE_ENTRIES, type PaletteEntry } from './defs';
import { Preview, buildBody, buildSpawnPreview } from './previews';
import { h } from './ui';

const TW = 144;
const TH = 104;

/** Renders palette thumbnails with the game's own ink pipeline, a few per frame. */
class Thumbnailer {
  private canvas = document.createElement('canvas');
  private pipe: RenderPipeline | null = null;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, TW / TH, 0.05, 400);
  private queue: { e: PaletteEntry; img: HTMLImageElement }[] = [];
  private cache = new Map<string, string>();
  private busy = false;

  constructor() {
    this.scene.fog = new THREE.FogExp2(0x2a2c36, 0.00001);
    const hemi = new THREE.HemisphereLight(0xb9c8f0, 0x6a5a48, 1.3);
    const sun = new THREE.DirectionalLight(0xfff0d6, 2.6);
    sun.position.set(-4, 8, -6);
    hemi.layers.enableAll();
    sun.layers.enableAll();
    this.scene.add(hemi, sun);
  }

  request(e: PaletteEntry, img: HTMLImageElement) {
    const c = this.cache.get(e.key);
    if (c) {
      img.src = c;
      return;
    }
    this.queue.push({ e, img });
    this.pump();
  }

  private pump() {
    if (this.busy) return;
    this.busy = true;
    const step = () => {
      const t0 = performance.now();
      while (this.queue.length && performance.now() - t0 < 12) {
        const { e, img } = this.queue.shift()!;
        let url = this.cache.get(e.key);
        if (!url) {
          try {
            url = this.render(e);
          } catch (err) {
            console.warn('[editor] thumbnail failed', e.key, err);
            url = '';
          }
          this.cache.set(e.key, url);
        }
        if (url) img.src = url;
      }
      if (this.queue.length) requestAnimationFrame(step);
      else this.busy = false;
    };
    requestAnimationFrame(step);
  }

  private render(e: PaletteEntry) {
    if (!this.pipe) {
      this.canvas.width = TW;
      this.canvas.height = TH;
      this.pipe = new RenderPipeline(this.canvas);
      this.pipe.forcedScale = 1;
      this.pipe.post.uniforms.uVignette.value = 0;
      // resize() reads devicePixelRatio; keep thumbnails at a fixed size
      this.pipe.renderer.setPixelRatio(1);
      this.pipe.resize(TW / Math.min(window.devicePixelRatio || 1, 2), TH / Math.min(window.devicePixelRatio || 1, 2));
    }
    const p = new Preview('thumb');
    if (e.make) {
      const o = e.make();
      buildBody(p, o);
    } else buildSpawnPreview(p);
    p.helpers.visible = false;
    this.scene.add(p.root);
    const box = p.bbox;
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(0.3, box.getSize(new THREE.Vector3()).length() / 2);
    const dist = r / Math.sin(THREE.MathUtils.degToRad(15)) * 0.95;
    const dir = new THREE.Vector3(-0.75, 0.62, -1).normalize();
    this.cam.position.copy(c).addScaledVector(dir, dist);
    this.cam.lookAt(c);
    this.cam.near = dist * 0.05;
    this.cam.far = dist * 4;
    this.cam.updateProjectionMatrix();
    this.pipe.render(this.scene, this.cam, { viewFov: 50, drawView: false });
    const url = this.canvas.toDataURL('image/png');
    p.dispose();
    return url;
  }
}

export class Palette {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private tabs: HTMLElement;
  private search: HTMLInputElement;
  private tab = 'shapes';
  private thumbs = new Thumbnailer();
  private cards = new Map<string, HTMLElement>();
  active: string | null = null;

  constructor(private onPick: (key: string) => void) {
    this.search = h('input', { class: 'pal-search', type: 'search', placeholder: 'Search everything…  (e.g. crate, enemy)', spellcheck: false }) as HTMLInputElement;
    this.search.addEventListener('input', () => this.render());
    this.search.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        this.search.value = '';
        this.render();
        this.search.blur();
      }
      if (e.key === 'Enter') {
        const first = this.list.querySelector('.pal-card') as HTMLElement | null;
        first?.click();
      }
    });
    this.tabs = h('div', { class: 'pal-tabs' });
    for (const t of PALETTE) {
      this.tabs.append(
        h('button', {
          class: 'pal-tab',
          'data-tab': t.id,
          text: t.label,
          onclick: () => {
            this.tab = t.id;
            this.search.value = '';
            this.render();
          },
        }),
      );
    }
    this.list = h('div', { class: 'pal-list' });
    this.el = h('div', { class: 'palette' }, h('div', { class: 'panel-title', text: 'Place' }), this.search, this.tabs, this.list, h('div', { class: 'pal-foot', text: 'Click an item, then click in the world. Hold Shift to keep placing. Esc cancels.' }));
    this.render();
  }

  showTab(id: string) {
    this.tab = id;
    this.search.value = '';
    this.render();
  }

  setActive(key: string | null) {
    this.active = key;
    for (const [k, c] of this.cards) c.classList.toggle('on', k === key);
  }

  private card(e: PaletteEntry) {
    const img = h('img', { class: 'pal-thumb', alt: '', draggable: false }) as HTMLImageElement;
    const c = h(
      'button',
      { class: 'pal-card' + (this.active === e.key ? ' on' : ''), 'data-key': e.key, title: (e.hint ? e.hint + ' — ' : '') + 'click, then click in the world (or drag it in)', draggable: true },
      img,
      h('span', { class: 'pal-name', text: e.label }),
      e.hint ? h('span', { class: 'pal-hint', text: e.hint }) : null,
    );
    c.addEventListener('click', () => this.onPick(e.key));
    c.addEventListener('dragstart', (ev) => {
      ev.dataTransfer?.setData('text/x-emg-palette', e.key);
      ev.dataTransfer!.effectAllowed = 'copy';
    });
    this.thumbs.request(e, img);
    this.cards.set(e.key, c);
    return c;
  }

  render() {
    this.cards.clear();
    this.list.textContent = '';
    const q = this.search.value.trim().toLowerCase();
    for (const b of this.tabs.children) (b as HTMLElement).classList.toggle('on', !q && (b as HTMLElement).dataset.tab === this.tab);
    if (q) {
      const hits = Object.values(PALETTE_ENTRIES).filter((e) => (e.label + ' ' + (e.hint ?? '') + ' ' + e.key).toLowerCase().includes(q));
      if (!hits.length) this.list.append(h('div', { class: 'pal-empty', text: 'Nothing matches “' + q + '”' }));
      const grid = h('div', { class: 'pal-grid' });
      for (const e of hits) grid.append(this.card(e));
      this.list.append(grid);
      return;
    }
    const tab = PALETTE.find((t) => t.id === this.tab) ?? PALETTE[0];
    for (const g of tab.groups) {
      this.list.append(h('div', { class: 'pal-group', text: g.title }));
      const grid = h('div', { class: 'pal-grid' });
      for (const e of g.entries) grid.append(this.card(e));
      this.list.append(grid);
    }
  }
}
