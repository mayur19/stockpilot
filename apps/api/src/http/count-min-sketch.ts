import { createHmac } from 'node:crypto';

/**
 * Fixed-size, non-evictable failure sketch (ADR-0020).
 *
 * A count-min sketch with `depth` rows of `width` counters, keyed by
 * HMAC(secret, key) so an attacker cannot aim collisions at a victim. It is the
 * durable source of truth for login lockouts: the precision Map in
 * rate-limiter.ts may evict entries under memory pressure, but a key that
 * returns is re-seeded from the sketch at (at least) its true strength.
 *
 * - Counts: estimate = min over rows, which never under-counts. Collisions can
 *   only over-count, i.e. over-throttle one bucket, never unlock anyone.
 * - Last failure time: each cell keeps the max timestamp written to it; the
 *   estimate is the min over rows, which is never earlier than the true value.
 * - Windowed decay: two generations rotate every `generationMs`; failures older
 *   than two generations are forgotten. Memory is constant:
 *   depth x width x (2 x 4 + 8) bytes = 1 MiB for 4 x 16384.
 */
export interface FailureSketch {
  record(key: string): void;
  estimate(key: string): { count: number; lastAt: number };
}

export interface SketchOptions {
  readonly secret: string;
  readonly generationMs: number;
  readonly depth?: number;
  readonly width?: number;
  readonly now?: () => number;
}

export function createFailureSketch(options: SketchOptions): FailureSketch {
  const depth = options.depth ?? 4;
  const width = options.width ?? 16_384;
  const now = options.now ?? Date.now;
  if (depth < 1 || depth > 8 || width < 2) throw new Error('Invalid sketch dimensions');

  let current = new Uint32Array(depth * width);
  let previous = new Uint32Array(depth * width);
  let lastAt = new Float64Array(depth * width);
  let generationStartedAt = now();

  const rotate = (): void => {
    const elapsed = now() - generationStartedAt;
    if (elapsed < options.generationMs) return;
    if (elapsed >= 2 * options.generationMs) {
      previous = new Uint32Array(depth * width);
      lastAt = new Float64Array(depth * width);
    } else {
      previous = current;
    }
    current = new Uint32Array(depth * width);
    generationStartedAt = now();
  };

  const cells = (key: string): number[] => {
    const digest = createHmac('sha256', options.secret).update(key).digest();
    return Array.from(
      { length: depth },
      (_, row) => row * width + (digest.readUInt32BE(row * 4) % width),
    );
  };

  return {
    record: (key) => {
      rotate();
      const at = now();
      for (const cell of cells(key)) {
        current[cell] = Math.min((current[cell] ?? 0) + 1, 0xffffffff);
        lastAt[cell] = Math.max(lastAt[cell] ?? 0, at);
      }
    },
    estimate: (key) => {
      rotate();
      let count = Infinity;
      let last = Infinity;
      for (const cell of cells(key)) {
        count = Math.min(count, (current[cell] ?? 0) + (previous[cell] ?? 0));
        last = Math.min(last, lastAt[cell] ?? 0);
      }
      return { count: count === Infinity ? 0 : count, lastAt: last === Infinity ? 0 : last };
    },
  };
}
