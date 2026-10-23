# @iseljao/cache-manager

Typed, multi-tier cache with pluggable stores (memory, Redis, MongoDB).

## Installation

```sh
pnpm add @iseljao/cache-manager
```

The memory adapter works out of the box. Other adapters need their driver installed:

| Adapter | Import                           | Export               | Extra dependency   |
| ------- | -------------------------------- | -------------------- | ------------------ |
| Memory  | `@iseljao/cache-manager`         | `MemoryStoreAdapter` | none               |
| Redis   | `@iseljao/cache-manager/redis`   | `RedisStoreAdapter`  | `pnpm add ioredis` |
| MongoDB | `@iseljao/cache-manager/mongodb` | `MongoStoreAdapter`  | `pnpm add mongodb` |

`CacheManager` and the shared types are exported from `@iseljao/cache-manager`. These three are the only import paths; deep imports such as `@iseljao/cache-manager/adapters/...` are not supported.

## Usage

```ts
import { CacheManager, MemoryStoreAdapter } from "@iseljao/cache-manager";
import { RedisStoreAdapter } from "@iseljao/cache-manager/redis";

const cache = new CacheManager<{ user: { name: string } }>({
  stores: [new MemoryStoreAdapter(), new RedisStoreAdapter({ url: "redis://localhost:6379" })],
  onError: console.error,
});

await cache.start();
await cache.set("user", { name: "Ada" }, { ttl: 60 });
await cache.get("user");
await cache.dispose();
```

## Options

| Option     | Default  | Description                                                  |
| ---------- | -------- | ------------------------------------------------------------ |
| `stores`   | required | Checked in order, fastest first                              |
| `onError`  | required | Gets errors from stores that the manager recovers from       |
| `strict`   | `false`  | Throw on `get`/`set` errors instead of skipping the store    |
| `fillBack` | `true`   | Copy hits from lower tiers into the tiers above (see below)  |

`set` takes `ttl` in seconds or `expiresAt` as a timestamp in milliseconds.

## Fill-back

`get` checks the stores in order. A hit in a lower tier is copied into the tiers above it in the background, with the original expiry kept. Fill-back errors go to `onError`. To turn it off, pass `fillBack: false`.

## Error handling

- `get`: a failing store counts as a miss and the next store is tried.
- `set`: the other stores are still written.
- `delete` and `clear` throw an `AggregateError` if any store fails, even without `strict`, since a failed delete leaves stale data behind.
- `start`: if any store fails, the ones that started are disposed, then it throws.

With `strict: true`, `get` and `set` throw instead of reporting to `onError`.
