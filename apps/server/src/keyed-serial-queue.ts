export class KeyedSerialQueue {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const queued = previous.catch(() => undefined).then(() => barrier);
    this.#tails.set(key, queued);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.#tails.get(key) === queued) this.#tails.delete(key);
    }
  }
}
