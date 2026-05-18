import { env } from "./env.js";
import Redis from "ioredis";

export const redis = new Redis(env.redisUrl, { lazyConnect: true });

let connected = false;
async function ensure() {
  if (!connected) {
    await redis.connect().catch(() => {});
    connected = true;
  }
}

/** Cache-aside helper. Falls back to the producer if Redis is unavailable. */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  produce: () => Promise<T>,
): Promise<T> {
  try {
    await ensure();
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    /* cache optional */
  }
  const value = await produce();
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    /* cache optional */
  }
  return value;
}
