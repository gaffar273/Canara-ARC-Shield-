import { config } from "../config/index.js";
import type { JobQueue } from "./types.js";
import { InProcessQueue } from "./inProcessQueue.js";

/**
 * Returns the queue driver for the current environment. In-process by default;
 * a BullMQ implementation activates when REDIS_URL is set. Callers depend only
 * on the JobQueue interface, so the driver is swappable without code changes.
 */
export function createQueue<T>(name: string): JobQueue<T> {
  if (config.queue.redisUrl) {
    // BullMQ driver is loaded here once Redis is provisioned. Until then the
    // in-process driver keeps the pipeline running with zero infra.
    console.warn(
      `[queue] REDIS_URL set but BullMQ driver not yet wired; using in-process for ${name}`,
    );
  }
  return new InProcessQueue<T>(name, config.queue.concurrency);
}

export type { JobQueue } from "./types.js";
