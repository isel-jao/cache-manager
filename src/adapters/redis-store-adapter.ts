import { Redis, RedisOptions } from "ioredis";
import { CacheManagerStore, SetOptions, StoredValue } from "../types.js";

export interface RedisStoreOption {
  url?: string; // e.g. redis://user:pass@localhost:6379/0
  redisOptions?: Omit<RedisOptions, "lazyConnect">;
}

export class RedisStoreAdapter<
  R extends Record<string, unknown> = Record<string, unknown>,
> implements CacheManagerStore<R> {
  private client: Redis;

  constructor(options: RedisStoreOption) {
    const redisOptions: RedisOptions = {
      lazyConnect: true,
      ...(options.redisOptions ?? {}),
    };
    if (options.url) {
      this.client = new Redis(options.url, redisOptions);
    } else {
      this.client = new Redis(redisOptions);
    }
  }

  public async get<K extends keyof R>(
    key: K,
  ): Promise<StoredValue<R[K]> | undefined> {
    const redisKey = String(key);
    // MULTI keeps GET and PTTL atomic: the key can't expire between them
    const results = await this.client
      .multi()
      .get(redisKey)
      .pttl(redisKey)
      .exec();
    if (!results) return undefined;

    const [[getErr, value], [pttlErr, pttl]] = results as [
      [Error | null, string | null],
      [Error | null, number],
    ];
    if (getErr) throw getErr;
    if (pttlErr) throw pttlErr;
    if (value === null) return undefined;

    return {
      value: JSON.parse(value) as R[K],
      expiresAt: pttl > 0 ? Date.now() + pttl : null,
    };
  }

  public async set<K extends keyof R>(
    key: K,
    value: R[K],
    setOptions?: SetOptions,
  ): Promise<void> {
    const redisKey = String(key);
    const serialized = JSON.stringify(value) ?? "null"; // undefined is not serializable

    if (setOptions?.ttl) {
      await this.client.set(redisKey, serialized, "PX", setOptions.ttl * 1000);
    } else if (setOptions?.expiresAt) {
      await this.client.set(redisKey, serialized, "PXAT", setOptions.expiresAt);
    } else {
      await this.client.set(redisKey, serialized);
    }
  }

  public async delete<K extends keyof R>(key: K): Promise<void> {
    await this.client.del(String(key));
  }

  public async clear(): Promise<void> {
    await this.client.flushdb();
  }

  public async start(): Promise<void> {
    await this.client.connect();
  }

  public async dispose(): Promise<void> {
    await this.client.quit();
  }
}
