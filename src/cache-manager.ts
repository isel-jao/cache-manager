import { CacheManagerStore, SetOptions, StoredValue } from "./types.js";

export type CacheOperation =
  | "get"
  | "set"
  | "fillBack"
  | "delete"
  | "clear"
  | "start"
  | "dispose";

export interface CacheErrorContext {
  op: CacheOperation;
  storeIndex: number;
  key?: PropertyKey;
}

interface CacheManagerOptions<R extends Record<string, unknown>> {
  stores: [CacheManagerStore<R>, ...ReadonlyArray<CacheManagerStore<R>>];
  fillBack?: boolean;
  // receives store errors the manager recovers from; pass () => {} to ignore them
  onError: (error: unknown, context: CacheErrorContext) => void;
  // rethrow get/set errors instead of degrading (fill-back errors only ever go to onError)
  strict?: boolean;
}

interface StoreFailure {
  error: unknown;
  storeIndex: number;
}

export class CacheManager<
  R extends Record<string, unknown> = Record<string, unknown>,
> {
  constructor(private options: CacheManagerOptions<R>) {
    // the type already forbids this, but JS callers and casts can still get here
    if (options.stores.length === 0) {
      throw new Error("cache-manager: at least one store is required");
    }
  }

  public async get<K extends keyof R>(key: K): Promise<R[K] | undefined> {
    for (const [storeIndex, store] of this.options.stores.entries()) {
      let entry: StoredValue<R[K]> | undefined;
      try {
        entry = await store.get(key);
      } catch (error) {
        if (this.options.strict) throw error;
        // a failing tier counts as a miss so the next tier still gets a chance
        this.options.onError(error, { op: "get", key, storeIndex });
        continue;
      }
      if (entry !== undefined) {
        this.fillBack(key, entry, storeIndex);
        return entry.value;
      }
    }
    return undefined;
  }

  public async start(): Promise<void> {
    const { stores } = this.options;
    const failures = await this.settle(stores, (store) => store.start?.());
    if (failures.length === 0) return;

    // don't leave the stores that did start holding connections
    const failed = new Set(failures.map((failure) => failure.storeIndex));
    const started = stores
      .map((store, storeIndex) => ({ store, storeIndex }))
      .filter(({ storeIndex }) => !failed.has(storeIndex));
    const disposeFailures = await this.settle(
      started.map(({ store }) => store),
      (store) => store.dispose(),
    );
    for (const { error, storeIndex } of disposeFailures) {
      this.options.onError(error, {
        op: "dispose",
        storeIndex: started[storeIndex]!.storeIndex,
      });
    }

    throw aggregate(failures, "start");
  }

  public async set<K extends keyof R>(
    key: K,
    value: R[K],
    options: SetOptions = {},
  ): Promise<void> {
    const { ttl, ...rest } = options;
    const newOptions: SetOptions = rest;
    if (ttl) {
      newOptions.expiresAt = Date.now() + ttl * 1000;
    }
    const failures = await this.settle(this.options.stores, (store) =>
      store.set(key, value, newOptions),
    );
    if (failures.length === 0) return;
    if (this.options.strict) throw aggregate(failures, "set");
    for (const { error, storeIndex } of failures) {
      this.options.onError(error, { op: "set", key, storeIndex });
    }
  }

  // invalidation failures leave stale data behind, so they always throw
  public async delete<K extends keyof R>(key: K): Promise<void> {
    const failures = await this.settle(this.options.stores, (store) =>
      store.delete(key),
    );
    if (failures.length > 0) throw aggregate(failures, "delete");
  }

  public async clear(): Promise<void> {
    const failures = await this.settle(this.options.stores, (store) =>
      store.clear(),
    );
    if (failures.length > 0) throw aggregate(failures, "clear");
  }

  public async dispose(): Promise<void> {
    const failures: StoreFailure[] = [];
    for (const [storeIndex, store] of this.options.stores.entries()) {
      try {
        await store.dispose();
      } catch (error) {
        failures.push({ error, storeIndex });
      }
    }
    if (failures.length > 0) throw aggregate(failures, "dispose");
  }

  // runs in the background: it must never reject, or Node crashes on the unhandled rejection
  private fillBack<K extends keyof R>(
    key: K,
    entry: StoredValue<R[K]>,
    storeIndex: number,
  ): void {
    if (this.options.fillBack === false || storeIndex === 0) return;
    this.settle(this.options.stores.slice(0, storeIndex), (store) =>
      store.set(key, entry.value, {
        expiresAt: entry.expiresAt ? entry.expiresAt : undefined,
      }),
    )
      .then((failures) => {
        for (const failure of failures) {
          this.options.onError(failure.error, {
            op: "fillBack",
            key,
            storeIndex: failure.storeIndex,
          });
        }
      })
      // only reachable if onError itself throws; there is nowhere left to send it
      .catch(() => {});
  }

  private async settle(
    stores: Readonly<CacheManagerStore<R>[]>,
    run: (store: CacheManagerStore<R>) => Promise<void> | undefined,
  ): Promise<StoreFailure[]> {
    const results = await Promise.allSettled(
      stores.map(async (store) => run(store)),
    );
    return results.flatMap((result, storeIndex) =>
      result.status === "rejected"
        ? [{ error: result.reason, storeIndex }]
        : [],
    );
  }
}

function aggregate(failures: StoreFailure[], op: CacheOperation) {
  const indexes = failures.map((failure) => failure.storeIndex).join(", ");
  return new AggregateError(
    failures.map((failure) => failure.error),
    `cache-manager: ${op} failed on store(s) ${indexes}`,
  );
}
