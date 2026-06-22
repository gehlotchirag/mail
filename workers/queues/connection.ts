import IORedis from 'ioredis';

let _redis: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (_redis) return _redis;
  const url = new URL(process.env.REDIS_URL!);
  _redis = new IORedis({
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return _redis;
}
