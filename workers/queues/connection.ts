import IORedis from 'ioredis';
import type { ConnectionOptions } from 'bullmq';

let _redis: IORedis | null = null;

// bullmq bundles its own copy of ioredis, so the structurally identical Redis
// classes are nominally different types. Return bullmq's ConnectionOptions —
// every caller hands this straight to a Queue/Worker.
export function getRedisConnection(): ConnectionOptions {
  if (_redis) return _redis as unknown as ConnectionOptions;
  const url = new URL(process.env.REDIS_URL!);
  _redis = new IORedis({
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return _redis as unknown as ConnectionOptions;
}
