type PendingRead<T> = {
  key: string;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

/** A small synthetic readback gate for adverse ordering and observation-time tests. */
export function createReadbackFixture<T>(initialObservation = '2026-10-31T18:00:00.000Z') {
  let armed = false;
  let observedAt = Date.parse(initialObservation);
  const queued: PendingRead<T>[] = [];

  function take(key: string) {
    const index = queued.findIndex(read => read.key === key);
    if (index < 0) throw new Error(`No queued synthetic readback for ${key}`);
    return queued.splice(index, 1)[0]!;
  }

  return {
    arm() { armed = true; },
    read(key: string, immediate: () => T | Promise<T>): Promise<T> {
      if (!armed) return Promise.resolve().then(immediate);
      return new Promise<T>((resolve, reject) => queued.push({ key, resolve, reject }));
    },
    pending(key?: string) { return key === undefined ? queued.length : queued.filter(read => read.key === key).length; },
    resolve(key: string, value: T) { take(key).resolve(value); },
    reject(key: string, reason?: unknown) { take(key).reject(reason); },
    observationTime() { return new Date(observedAt).toISOString(); },
    advanceObservation(milliseconds = 1_000) {
      observedAt += milliseconds;
      return new Date(observedAt).toISOString();
    },
  };
}
