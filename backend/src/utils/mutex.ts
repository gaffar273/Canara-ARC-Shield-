/**
 * Serializes async sections so concurrent callers cannot interleave a
 * read-modify-write on shared state. One writer at a time, FIFO order.
 */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
