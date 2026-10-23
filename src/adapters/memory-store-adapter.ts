import { CacheManagerStore, SetOptions, StoredValue } from "../types.js";

export interface MemoryStoreOption {
  sweepInterval?: number; // in seconds
}

export class MemoryStoreAdapter<
  R extends Record<string, unknown> = Record<string, unknown>,
> implements CacheManagerStore<R> {
  private cache: Map<keyof R, StoredValue<R[keyof R]>> = new Map();

  private sweepIntervalId: NodeJS.Timeout | undefined;
  private sweepInterval: number;

  constructor(options: MemoryStoreOption = {}) {
    this.sweepInterval = options.sweepInterval ?? 60; // default to 60 seconds
  }

  public async get<K extends keyof R>(
    key: K,
  ): Promise<StoredValue<R[K]> | undefined> {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (this.isExpired(entry.expiresAt)) {
      this.cache.delete(key);
      return undefined;
    }
    return entry as StoredValue<R[K]>;
  }

  public async set<K extends keyof R>(
    key: K,
    value: R[K],
    options?: SetOptions,
  ): Promise<void> {
    let expiresAt: number | null = null;
    if (options?.ttl) {
      expiresAt = Date.now() + options.ttl * 1000;
    } else if (options?.expiresAt) {
      expiresAt = options.expiresAt;
    }
    this.cache.set(key, { value, expiresAt });
  }

  public async delete<K extends keyof R>(key: K): Promise<void> {
    this.cache.delete(key);
  }

  public async clear(): Promise<void> {
    this.cache.clear();
  }

  public async start(): Promise<void> {
    this.startSweeper();
  }

  public async dispose(): Promise<void> {
    if (this.sweepIntervalId) {
      clearInterval(this.sweepIntervalId);
    }
    this.cache.clear();
  }

  private isExpired(expiresAt: number | null): boolean {
    if (expiresAt === null) return false;
    return Date.now() > expiresAt;
  }

  private startSweeper() {
    this.sweepIntervalId = setInterval(() => {
      const now = Date.now();
      for (const [key, { expiresAt }] of this.cache.entries()) {
        if (this.isExpired(expiresAt)) {
          this.cache.delete(key);
        }
      }
    }, this.sweepInterval * 1000);
  }
}
