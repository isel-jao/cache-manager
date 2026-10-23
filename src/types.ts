export interface SetOptions {
  ttl?: number; // in seconds
  expiresAt?: number; // timestamp in milliseconds
}

export interface StoredValue<T = unknown> {
  value: T;
  expiresAt: number | null;
}

export interface CacheManagerStore<
  R extends Record<string, unknown> = Record<string, unknown>,
> {
  get<K extends keyof R>(key: K): Promise<StoredValue<R[K]> | undefined>;

  set<K extends keyof R>(
    key: K,
    value: R[K],
    options?: SetOptions,
  ): Promise<void>;
  delete<K extends keyof R>(key: K): Promise<void>;
  clear(): Promise<void>;
  start?(): Promise<void>;
  dispose(): Promise<void>;
}
