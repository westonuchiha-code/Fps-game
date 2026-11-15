/**
 * Sound packs. A production build bundles each folder of small sound files into one
 * `<folder>.pack` (see `soundPacks()` in vite.config.ts), so hundreds of requests become one.
 *
 *   bytes 0-3   'EMGP'
 *   bytes 4-7   header length, uint32 little-endian
 *   header      JSON: { "name.ogg": [offset, length], ... }   (offsets count from the end of the header)
 *   data        the files, back to back
 */
export class SoundPack {
  private constructor(
    private readonly index: Record<string, [number, number]>,
    private readonly data: ArrayBuffer,
    private readonly base: number,
  ) {}

  /** Resolves to null if the pack is missing or damaged; callers then fetch files one by one. */
  static async load(url: string): Promise<SoundPack | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.arrayBuffer();
      const view = new DataView(data);
      if (data.byteLength < 8 || view.getUint32(0, false) !== 0x454d4750) return null;
      const headLen = view.getUint32(4, true);
      const head = new TextDecoder().decode(new Uint8Array(data, 8, headLen));
      return new SoundPack(JSON.parse(head), data, 8 + headLen);
    } catch {
      return null;
    }
  }

  /** A private copy of one file's bytes (decodeAudioData takes ownership of what it is given). */
  get(name: string): ArrayBuffer | null {
    const e = this.index[name];
    if (!e) return null;
    return this.data.slice(this.base + e[0], this.base + e[0] + e[1]);
  }
}
