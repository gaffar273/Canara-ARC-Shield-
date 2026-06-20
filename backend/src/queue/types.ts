export interface JobQueue<T> {
  readonly name: string;
  enqueue(jobId: string, payload: T): Promise<void>;
  process(handler: (payload: T) => Promise<void>): void;
}
