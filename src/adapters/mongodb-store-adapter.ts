import { Collection, MongoClient, MongoClientOptions } from "mongodb";
import { CacheManagerStore, SetOptions, StoredValue } from "../types.js";

export interface MongoStoreOption {
  url: string; // e.g. mongodb://user:pass@localhost:27017
  dbName?: string;
  collectionName?: string;
  clientOptions?: MongoClientOptions;
}

interface CacheDocument {
  _id: string;
  value: unknown;
  expiresAt: Date | null;
}

export class MongoStoreAdapter<
  R extends Record<string, unknown> = Record<string, unknown>,
> implements CacheManagerStore<R> {
  private client: MongoClient;
  private collection: Collection<CacheDocument>;

  constructor(options: MongoStoreOption) {
    this.client = new MongoClient(options.url, options.clientOptions);
    this.collection = this.client
      .db(options.dbName ?? "cache")
      .collection<CacheDocument>(options.collectionName ?? "cache");
  }

  public async get<K extends keyof R>(
    key: K,
  ): Promise<StoredValue<R[K]> | undefined> {
    const id = String(key);
    const doc = await this.collection.findOne({ _id: id });
    if (!doc) return undefined;

    const expiresAt = doc.expiresAt ? doc.expiresAt.getTime() : null;
    // the TTL monitor only runs every ~60s, so expired docs may still exist
    if (expiresAt !== null && Date.now() > expiresAt) {
      await this.collection.deleteOne({ _id: id });
      return undefined;
    }

    return { value: doc.value as R[K], expiresAt };
  }

  public async set<K extends keyof R>(
    key: K,
    value: R[K],
    options?: SetOptions,
  ): Promise<void> {
    let expiresAt: Date | null = null;
    if (options?.ttl) {
      expiresAt = new Date(Date.now() + options.ttl * 1000);
    } else if (options?.expiresAt) {
      expiresAt = new Date(options.expiresAt);
    }
    await this.collection.replaceOne(
      { _id: String(key) },
      { value, expiresAt },
      { upsert: true },
    );
  }

  public async delete<K extends keyof R>(key: K): Promise<void> {
    await this.collection.deleteOne({ _id: String(key) });
  }

  public async clear(): Promise<void> {
    await this.collection.deleteMany({});
  }

  public async start(): Promise<void> {
    await this.client.connect();
    // let mongo remove expired documents on its own
    await this.collection.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 },
    );
  }

  public async dispose(): Promise<void> {
    await this.client.close();
  }
}
