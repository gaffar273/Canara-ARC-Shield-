interface Entry<V> {
  value: V;
  expires: number;
}

/**
 * Minimal TTL cache for derived/expensive reads. Time-based expiry is checked
 * lazily on read (no timers/polling). Writes are invalidated explicitly.
 */
export class TtlCache<V> {
  private readonly store = new Map<string, Entry<V>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expires) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  async wrap(key: string, produce: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await produce();
    this.set(key, value);
    return value;
  }
}
