import * as THREE from 'three';
import sfxManifestRaw from '../data/sfx-manifest.json';
import musicManifestRaw from '../data/music-manifest.json';
import voManifestRaw from '../data/vo-manifest.json';
import dialogueRaw from '../data/dialogue.json';
import { clamp, rand } from '../core/math';

interface SfxEntry {
  files: string[];
  dur: number;
  loop?: boolean;
}
interface MusicTrack {
  bpm: number;
  bars: number;
  beatsPerBar: number;
  loopSeconds: number;
  stems: Record<string, string>;
}
interface MusicManifest {
  tracks?: Record<string, MusicTrack>;
  stingers?: Record<string, { file: string; seconds: number }>;
}
interface DialogueData {
  speakers: Record<string, { name: string; color: string; style: string }>;
  lines: { id: string; who: string; text: string; say?: string }[];
  barks: Record<string, { voices: string[]; groups: Record<string, string[]> }>;
}

const sfxManifest = sfxManifestRaw as unknown as Record<string, SfxEntry>;
const musicManifest = musicManifestRaw as unknown as MusicManifest;
const voManifest = voManifestRaw as unknown as Record<string, { dur: number; who: string }>;
export const dialogue = dialogueRaw as unknown as DialogueData;

const BASE = import.meta.env.BASE_URL + 'audio/';

export interface PlayOpts {
  pos?: THREE.Vector3;
  vol?: number;
  pitch?: number;
  /** random pitch spread, e.g. 0.06 = ±6% */
  pitchVar?: number;
  delay?: number;
  bus?: 'sfx' | 'ui' | 'voice';
  /** distance at which the sound is at full volume */
  ref?: number;
  /** reverb send 0..1 */
  wet?: number;
  /** pick a specific variation (1-based); default random without immediate repeats */
  variant?: number;
  maxDist?: number;
}

export interface LoopHandle {
  setVolume(v: number, t?: number): void;
  setPitch(p: number, t?: number): void;
  setPos(p: THREE.Vector3): void;
  stop(fade?: number): void;
}

export interface Subtitle {
  who: string;
  name: string;
  color: string;
  text: string;
  dur: number;
}

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();

export class AudioSys {
  ctx!: AudioContext;
  private master!: GainNode;
  private buses!: Record<'sfx' | 'ui' | 'voice' | 'music', GainNode>;
  private muffle!: BiquadFilterNode;
  private reverb!: ConvolverNode;
  private reverbGain!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private lastVariant = new Map<string, number>();
  private warned = new Set<string>();
  private active = 0;
  private lastPlay = new Map<string, number>();
  ready = false;
  volumes = { master: 0.9, sfx: 1, music: 0.55, voice: 1 };
  readonly listenerPos = new THREE.Vector3();
  onSubtitle: ((s: Subtitle | null) => void) | null = null;

  // ---- music state ----
  private music: { id: string; gain: GainNode; stems: Record<string, { src: AudioBufferSourceNode; gain: GainNode }> } | null = null;
  private musicIntensity = 0;
  private musicDuck!: GainNode;

  // ---- voice state ----
  private voiceQueue: { id: string; resolve: () => void; pos?: THREE.Vector3; vol: number }[] = [];
  private voiceBusy = false;
  private barkCooldown = new Map<string, number>();
  private barksPlaying = 0;
  private currentVoice: AudioBufferSourceNode | null = null;

  init() {
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    this.master = ctx.createGain();
    this.master.connect(limiter).connect(ctx.destination);

    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.connect(this.master);

    const mk = (to: AudioNode) => {
      const g = ctx.createGain();
      g.connect(to);
      return g;
    };
    this.musicDuck = mk(this.muffle);
    this.buses = { sfx: mk(this.muffle), ui: mk(this.master), voice: mk(this.master), music: mk(this.musicDuck) };

    // Small synthetic "outdoor yard" impulse response: a few discrete slaps into a short noisy tail.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(1.6, 2.6);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.5;
    this.reverb.connect(this.reverbGain).connect(this.buses.sfx);
    this.applyVolumes();
    this.ready = true;
  }

  private makeImpulse(seconds: number, decay: number) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const n = Math.random() * 2 - 1;
        lp += (n - lp) * (0.55 - 0.4 * t); // tail gets darker
        d[i] = lp * Math.pow(1 - t, decay) * (i < 400 ? i / 400 : 1);
      }
      for (const tap of [0.031, 0.072, 0.118, 0.19]) {
        const i = Math.floor((tap + ch * 0.007) * ctx.sampleRate);
        if (i < len) d[i] += 0.7 * (1 - tap * 3);
      }
    }
    return buf;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.03);
    this.buses.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.03);
    this.buses.ui.gain.setTargetAtTime(this.volumes.sfx, t, 0.03);
    this.buses.voice.gain.setTargetAtTime(this.volumes.voice * 1.15, t, 0.03);
    this.buses.music.gain.setTargetAtTime(this.volumes.music, t, 0.03);
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }
  suspendAll(on: boolean) {
    if (!this.ctx) return;
    if (on) this.ctx.suspend().catch(() => {});
    else this.ctx.resume().catch(() => {});
  }

  /** Low-pass everything except UI/voice (pause menu, shield break, death). 20000 = off. */
  setMuffle(freq: number, time = 0.15) {
    if (!this.ctx) return;
    this.muffle.frequency.setTargetAtTime(freq, this.ctx.currentTime, time);
  }

  private async fetchBuffer(url: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(url);
    if (cached) return cached;
    let p = this.loading.get(url);
    if (!p) {
      p = (async () => {
        try {
          const res = await fetch(BASE + url);
          if (!res.ok) throw new Error(res.status + '');
          const arr = await res.arrayBuffer();
          const buf = await this.ctx.decodeAudioData(arr);
          this.buffers.set(url, buf);
          return buf;
        } catch (e) {
          if (!this.warned.has(url)) {
            this.warned.add(url);
            console.warn('[audio] failed to load', url);
          }
          return null;
        }
      })();
      this.loading.set(url, p);
    }
    return p;
  }

  /** Preload every sound effect. Resolves when done; `onProgress` gets 0..1. */
  async loadAllSfx(onProgress?: (f: number) => void) {
    const files: string[] = [];
    for (const k in sfxManifest) for (const f of sfxManifest[k].files) files.push('sfx/' + f);
    let done = 0;
    const queue = files.slice();
    const worker = async () => {
      while (queue.length) {
        const f = queue.pop()!;
        await this.fetchBuffer(f);
        done++;
        onProgress?.(done / files.length);
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
  }

  has(name: string) {
    return !!sfxManifest[name];
  }

  setListener(cam: THREE.Camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    cam.getWorldPosition(this.listenerPos);
    cam.getWorldDirection(_fwd);
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const p = this.listenerPos;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(p.x, t);
      l.positionY.setValueAtTime(p.y, t);
      l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(_fwd.x, t);
      l.forwardY.setValueAtTime(_fwd.y, t);
      l.forwardZ.setValueAtTime(_fwd.z, t);
      l.upX.setValueAtTime(_up.x, t);
      l.upY.setValueAtTime(_up.y, t);
      l.upZ.setValueAtTime(_up.z, t);
    } else {
      (l as any).setPosition(p.x, p.y, p.z);
      (l as any).setOrientation(_fwd.x, _fwd.y, _fwd.z, _up.x, _up.y, _up.z);
    }
  }

  private pickFile(name: string, variant?: number) {
    const e = sfxManifest[name];
    if (!e) {
      if (!this.warned.has(name)) {
        this.warned.add(name);
        console.warn('[audio] unknown sfx', name);
      }
      return null;
    }
    let i: number;
    if (variant) i = clamp(variant - 1, 0, e.files.length - 1);
    else if (e.files.length === 1) i = 0;
    else {
      const last = this.lastVariant.get(name) ?? -1;
      i = Math.floor(Math.random() * e.files.length);
      if (i === last) i = (i + 1) % e.files.length;
      this.lastVariant.set(name, i);
    }
    return 'sfx/' + e.files[i];
  }

  private makePanner(pos: THREE.Vector3, ref: number, maxDist: number) {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = 1.35;
    p.maxDistance = maxDist;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    return p;
  }

  /** Fire a one-shot. Safe to call for names that do not exist (warns once). */
  play(name: string, o: PlayOpts = {}) {
    if (!this.ready) return;
    // far-away positional sounds are skipped entirely
    const maxDist = o.maxDist ?? 140;
    if (o.pos && o.pos.distanceToSquared(this.listenerPos) > maxDist * maxDist) return;
    // throttle identical sounds fired in the same instant (shotgun pellets, explosions hitting many things)
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(name) ?? -1;
    if (now - last < 0.018 && !o.delay) return;
    this.lastPlay.set(name, now);
    if (this.active > 40) return;
    const file = this.pickFile(name, o.variant);
    if (!file) return;
    const buf = this.buffers.get(file);
    if (!buf) {
      // not preloaded yet: load for next time
      void this.fetchBuffer(file);
      return;
    }
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (o.pitch ?? 1) * (1 + (o.pitchVar ? rand(-o.pitchVar, o.pitchVar) : 0));
    const g = ctx.createGain();
    g.gain.value = o.vol ?? 1;
    let node: AudioNode = src.connect(g);
    if (o.pos) node = node.connect(this.makePanner(o.pos, o.ref ?? 5, maxDist));
    node.connect(this.buses[o.bus ?? 'sfx']);
    if (o.wet && o.wet > 0) {
      const send = ctx.createGain();
      send.gain.value = o.wet;
      node.connect(send).connect(this.reverb);
    }
    this.active++;
    src.onended = () => {
      this.active--;
    };
    src.start(now + (o.delay ?? 0));
  }

  loop(name: string, o: PlayOpts = {}): LoopHandle {
    const noop: LoopHandle = { setVolume() {}, setPitch() {}, setPos() {}, stop() {} };
    if (!this.ready) return noop;
    const file = this.pickFile(name, 1);
    if (!file) return noop;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    let panner: PannerNode | null = null;
    let node: AudioNode = g;
    if (o.pos) {
      panner = this.makePanner(o.pos, o.ref ?? 6, o.maxDist ?? 160);
      node = g.connect(panner);
    }
    node.connect(this.buses[o.bus ?? 'sfx']);
    let src: AudioBufferSourceNode | null = null;
    let stopped = false;
    let pitch = o.pitch ?? 1;
    let vol = o.vol ?? 1;
    const start = (buf: AudioBuffer) => {
      if (stopped) return;
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = pitch;
      src.connect(g);
      src.start();
      g.gain.setTargetAtTime(vol, ctx.currentTime, 0.08);
    };
    const buf = this.buffers.get(file);
    if (buf) start(buf);
    else void this.fetchBuffer(file).then((b) => b && start(b));
    return {
      setVolume: (v, t = 0.08) => {
        vol = v;
        g.gain.setTargetAtTime(v, ctx.currentTime, t);
      },
      setPitch: (p, t = 0.06) => {
        pitch = p;
        if (src) src.playbackRate.setTargetAtTime(p, ctx.currentTime, t);
      },
      setPos: (p) => {
        if (!panner) return;
        const t = ctx.currentTime;
        panner.positionX.setTargetAtTime(p.x, t, 0.03);
        panner.positionY.setTargetAtTime(p.y, t, 0.03);
        panner.positionZ.setTargetAtTime(p.z, t, 0.03);
      },
      stop: (fade = 0.15) => {
        if (stopped) return;
        stopped = true;
        g.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
        const s = src;
        setTimeout(() => {
          try {
            s?.stop();
          } catch {
            /* already stopped */
          }
          g.disconnect();
        }, fade * 1000 + 80);
      },
    };
  }

  // ------------------------------------------------------------------ music

  /** Crossfade to a looping track. All stems start sample-locked; `setMusicIntensity` blends the combat stem. */
  async playMusic(id: string | null, fade = 1.2) {
    if (!this.ready) return;
    if (this.music && this.music.id === id) return;
    const ctx = this.ctx;
    const old = this.music;
    this.music = null;
    if (old) {
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
      setTimeout(() => {
        for (const k in old.stems) {
          try {
            old.stems[k].src.stop();
          } catch {
            /* */
          }
        }
        old.gain.disconnect();
      }, fade * 1000 + 200);
    }
    if (!id) return;
    const track = musicManifest.tracks?.[id];
    if (!track) {
      if (!this.warned.has('music:' + id)) {
        this.warned.add('music:' + id);
        console.warn('[audio] unknown music track', id);
      }
      return;
    }
    const names = Object.keys(track.stems);
    const bufs = await Promise.all(names.map((n) => this.fetchBuffer('music/' + track.stems[n])));
    if (this.music) return; // something else started meanwhile
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.buses.music);
    const stems: Record<string, { src: AudioBufferSourceNode; gain: GainNode }> = {};
    const t0 = ctx.currentTime + 0.08;
    names.forEach((n, i) => {
      const buf = bufs[i];
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = n === 'combat' ? this.musicIntensity : 1;
      src.connect(g).connect(gain);
      src.start(t0);
      stems[n] = { src, gain: g };
    });
    gain.gain.setTargetAtTime(1, t0, fade / 3);
    this.music = { id, gain, stems };
  }

  hasMusic(id: string) {
    return !!musicManifest.tracks?.[id];
  }

  get musicId() {
    return this.music?.id ?? null;
  }

  /** 0 = exploration (base stem only), 1 = full combat. */
  setMusicIntensity(v: number, time = 1.2) {
    this.musicIntensity = clamp(v, 0, 1);
    const s = this.music?.stems.combat;
    if (s) s.gain.gain.setTargetAtTime(this.musicIntensity, this.ctx.currentTime, time / 3);
  }

  async stinger(name: string, vol = 1) {
    if (!this.ready) return;
    const st = musicManifest.stingers?.[name];
    if (!st) return;
    const buf = await this.fetchBuffer('music/' + st.file);
    if (!buf) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.buses.music);
    src.start();
  }

  private duck(on: boolean) {
    this.musicDuck.gain.setTargetAtTime(on ? 0.45 : 1, this.ctx.currentTime, on ? 0.08 : 0.4);
  }

  // ------------------------------------------------------------------ voice

  lineInfo(id: string): Subtitle | null {
    const line = dialogue.lines.find((l) => l.id === id);
    const dur = voManifest[id]?.dur;
    if (line) {
      const sp = dialogue.speakers[line.who];
      return { who: line.who, name: sp?.name ?? line.who, color: sp?.color ?? '#fff', text: line.text, dur: dur ?? Math.max(1.6, line.text.length * 0.065) };
    }
    // bark id: <voice>_<group>_<n>
    const m = /^([a-z]+)_([a-z]+)_(\d+)$/.exec(id);
    if (m) {
      for (const setName in dialogue.barks) {
        const set = dialogue.barks[setName];
        if (set.voices.includes(m[1]) && set.groups[m[2]]) {
          const text = set.groups[m[2]][+m[3] - 1];
          if (text) {
            const sp = dialogue.speakers[m[1]];
            return { who: m[1], name: sp?.name ?? m[1], color: sp?.color ?? '#fff', text, dur: dur ?? Math.max(1, text.length * 0.06) };
          }
        }
      }
    }
    return null;
  }

  preloadVoice(ids: string[]) {
    for (const id of ids) void this.fetchBuffer('vo/' + id + '.ogg');
  }

  /**
   * Speak a story line (queued, never overlaps another story line). Shows a subtitle and ducks the music.
   * Resolves when the line has finished (or its estimated duration elapsed if the file is missing).
   */
  say(id: string, opts: { pos?: THREE.Vector3; vol?: number } = {}): Promise<void> {
    return new Promise((resolve) => {
      this.voiceQueue.push({ id, resolve, pos: opts.pos, vol: opts.vol ?? 1 });
      void this.pumpVoice();
    });
  }

  get speaking() {
    return this.voiceBusy || this.voiceQueue.length > 0;
  }

  /** Drop any queued/playing story lines (cutscene skip). */
  flushVoice() {
    for (const q of this.voiceQueue) q.resolve();
    this.voiceQueue.length = 0;
    try {
      this.currentVoice?.stop();
    } catch {
      /* */
    }
  }

  private async pumpVoice() {
    if (this.voiceBusy) return;
    const item = this.voiceQueue.shift();
    if (!item) return;
    this.voiceBusy = true;
    const info = this.lineInfo(item.id);
    const buf = this.ready ? await this.fetchBuffer('vo/' + item.id + '.ogg') : null;
    const dur = buf ? buf.duration : (info?.dur ?? 2);
    if (info) this.onSubtitle?.({ ...info, dur });
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      this.currentVoice = null;
      if (this.ready) this.duck(false);
      this.onSubtitle?.(null);
      this.voiceBusy = false;
      item.resolve();
      setTimeout(() => void this.pumpVoice(), 180);
    };
    if (buf && this.ready) {
      const ctx = this.ctx;
      this.duck(true);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = item.vol;
      let node: AudioNode = src.connect(g);
      if (item.pos) node = node.connect(this.makePanner(item.pos, 9, 200));
      node.connect(this.buses.voice);
      src.onended = finish;
      this.currentVoice = src;
      src.start();
      // safety: never hang the queue if `ended` is not delivered (tab hidden, context suspended)
      setTimeout(finish, dur * 1000 + 1500);
    } else {
      setTimeout(finish, dur * 1000);
    }
  }

  /**
   * Combat chatter. `voice` is the speaker id ('assoc', 'rivet', ...), `group` a bark group from dialogue.json.
   * Rate-limited per voice+group and globally so fights don't turn into a wall of speech.
   * Returns true if the bark actually played.
   */
  bark(voice: string, group: string, pos: THREE.Vector3 | null, opts: { pitch?: number; cooldown?: number; force?: boolean; vol?: number } = {}) {
    if (!this.ready) return false;
    let count = 0;
    for (const setName in dialogue.barks) {
      const set = dialogue.barks[setName];
      if (set.voices.includes(voice) && set.groups[group]) count = set.groups[group].length;
    }
    if (!count) return false;
    const now = this.ctx.currentTime;
    const key = voice + ':' + group;
    if (!opts.force) {
      if (this.barksPlaying >= 2) return false;
      if ((this.barkCooldown.get(key) ?? 0) > now) return false;
      if ((this.barkCooldown.get('*' + voice) ?? 0) > now) return false;
      if (pos && pos.distanceToSquared(this.listenerPos) > 45 * 45) return false;
    }
    this.barkCooldown.set(key, now + (opts.cooldown ?? 6));
    this.barkCooldown.set('*' + voice, now + 1.6);
    const n = 1 + Math.floor(Math.random() * count);
    const id = `${voice}_${group}_${n}`;
    const file = 'vo/' + id + '.ogg';
    const buf = this.buffers.get(file);
    if (!buf) {
      void this.fetchBuffer(file);
      return false;
    }
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.pitch ?? 1;
    const g = ctx.createGain();
    g.gain.value = opts.vol ?? 1;
    let node: AudioNode = src.connect(g);
    if (pos) node = node.connect(this.makePanner(pos, 7, 90));
    node.connect(this.buses.voice);
    this.barksPlaying++;
    src.onended = () => {
      this.barksPlaying = Math.max(0, this.barksPlaying - 1);
    };
    src.start();
    return true;
  }

  /** Warm the cache for every bark of the given voices so the first use is not silent. */
  preloadBarks(voices: string[]) {
    for (const setName in dialogue.barks) {
      const set = dialogue.barks[setName];
      for (const v of set.voices) {
        if (!voices.includes(v)) continue;
        for (const g in set.groups) set.groups[g].forEach((_, i) => void this.fetchBuffer(`vo/${v}_${g}_${i + 1}.ogg`));
      }
    }
  }
}
