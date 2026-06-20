import type { JobQueue } from "./types.js";

interface Job<T> {
  jobId: string;
  payload: T;
}

/**
 * In-process queue. Event-driven: enqueue kicks the pump, which drains the
 * backlog up to `concurrency` jobs at a time. No polling, no timers. A handler
 * failure is isolated so it never stops the pump.
 */
export class InProcessQueue<T> implements JobQueue<T> {
  private readonly backlog: Job<T>[] = [];
  private handler: ((payload: T) => Promise<void>) | null = null;
  private active = 0;

  constructor(
    readonly name: string,
    private readonly concurrency: number,
  ) {}

  async enqueue(jobId: string, payload: T): Promise<void> {
    this.backlog.push({ jobId, payload });
    this.pump();
  }

  process(handler: (payload: T) => Promise<void>): void {
    this.handler = handler;
    this.pump();
  }

  private pump(): void {
    if (!this.handler) return;
    while (this.active < this.concurrency && this.backlog.length > 0) {
      const job = this.backlog.shift();
      if (!job) break;
      this.active += 1;
      void this.run(job);
    }
  }

  private async run(job: Job<T>): Promise<void> {
    const handler = this.handler;
    if (!handler) return;
    try {
      await handler(job.payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[queue:${this.name}] job ${job.jobId} failed: ${message}`);
    } finally {
      this.active -= 1;
      this.pump();
    }
  }
}
