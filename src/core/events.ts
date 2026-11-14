type Handler<T> = (payload: T) => void;

/** Tiny typed event bus. */
export class Emitter<E extends Record<string, unknown>> {
  private map = new Map<keyof E, Set<Handler<any>>>();
  on<K extends keyof E>(type: K, fn: Handler<E[K]>) {
    let s = this.map.get(type);
    if (!s) this.map.set(type, (s = new Set()));
    s.add(fn);
    return () => s!.delete(fn);
  }
  emit<K extends keyof E>(type: K, payload: E[K]) {
    const s = this.map.get(type);
    if (s) for (const fn of [...s]) fn(payload);
  }
  clear() {
    this.map.clear();
  }
}
