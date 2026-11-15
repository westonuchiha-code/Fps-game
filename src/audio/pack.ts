/**
 * Sound packs. A production build bundles each folder of small sound files into one
 * `<folder>-pack.json` (see `soundPacks()` in vite.config.ts), so hundreds of requests become one.
 * It is plain JSON — `{ "name.ogg": "<base64>" }` — because every static host serves JSON, and the
 * host's compression takes back most of the base64 overhead.
 */
export class SoundPack {
  private constructor(private readonly files: Record<string, string>) {}

  /** Resolves to null if the pack is missing or damaged; callers then fetch files one by one. */
  static async load(url: string): Promise<SoundPack | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const files = (await res.json()) as Record<string, string>;
      return files && typeof files === 'object' ? new SoundPack(files) : null;
    } catch {
      return null;
    }
  }

  /** One file's bytes. Each file is handed out once (the audio engine keeps the decoded sound). */
  get(name: string): ArrayBuffer | null {
    const b64 = this.files[name];
    if (typeof b64 !== 'string') return null;
    delete this.files[name];
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
}
