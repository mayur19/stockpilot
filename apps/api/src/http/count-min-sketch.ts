import { createHmac } from 'node:crypto';

/**
 * Fixed-size overflow sketch for evicted lock-outs (ADR-0020).
 *
 * The precise per-email Map in rate-limiter.ts is authoritative. Only when it
 * must force-evict an entry that is still active does that entry's failure count
 * and latest failure time get absorbed here; the sketch is read only for keys
 * that have no precise Map entry. Ordinary failures never touch it, so failures
 * spread across many emails cannot lock out an untouched email, and a reset on
 * successful login (a precise zero entry) always wins.
 *
 * - Count-min: estimate = min over rows (never under-counts what was absorbed).
 * - Latest failure: per-cell max, estimate = min over rows.
 * - Keys are HMAC(secret, key) so collisions cannot be aimed at a victim.
 * - Two rotating generations give windowed decay. Memory is constant
 *   (4 x 16384 cells ~ 1 MiB).
 * - Saturation guard: if any row is more than 50% occupied the sketch is ignored
 *   for reads (it would start over-throttling unrelated users), an alert is
 *   raised and `saturatedReads` is incremented.
 */
export interface FailureSketch {
  absorb(key: string, count: number, lastAt: number): void;
  /** Null when nothing was absorbed for the key or the sketch is saturated. */
  estimate(key: string): { count: number; lastAt: number } | null;
  stats(): { saturatedReads: number; maxRowOccupancy: number };
}

export interface SketchOptions {
  readonly secret: string;
  readonly generationMs: number;
  readonly depth?: number;
  readonly width?: number;
  readonly now?: () => number;
  readonly onAlert?: (event: string, detail: Record<string, unknown>) => void;
}

export const SATURATION_THRESHOLD = 0.5;

export function createFailureSketch(options: SketchOptions): FailureSketch {
  const depth = options.depth ?? 4;
  const width = options.width ?? 16_384;
  const now = options.now ?? Date.now;
  if (depth < 1 || depth > 8 || width < 2) throw new Error('Invalid sketch dimensions');

  const fresh = () => ({
    counts: new Uint32Array(depth * width),
    lastAt: new Float64Array(depth * width),
    occupied: new Uint32Array(depth),
  });
  let current = fresh();
  let previous = fresh();
  let generationStartedAt = now();
  let saturatedReads = 0;

  const rotate = (): void => {
    const elapsed = now() - generationStartedAt;
    if (elapsed < options.generationMs) return;
    previous = elapsed >= 2 * options.generationMs ? fresh() : current;
    current = fresh();
    generationStartedAt = now();
  };

  const cells = (key: string): number[] => {
    const digest = createHmac('sha256', options.secret).update(key).digest();
    return Array.from(
      { length: depth },
      (_, row) => row * width + (digest.readUInt32BE(row * 4) % width),
    );
  };

  /** Upper bound on the occupied fraction of the fullest row across both generations. */
  const maxRowOccupancy = (): number => {
    let max = 0;
    for (let row = 0; row < depth; row += 1) {
      max = Math.max(max, ((current.occupied[row] ?? 0) + (previous.occupied[row] ?? 0)) / width);
    }
    return max;
  };

  return {
    absorb: (key, count, lastAt) => {
      rotate();
      cells(key).forEach((cell, row) => {
        const before = current.counts[cell] ?? 0;
        if (before === 0) current.occupied[row] = (current.occupied[row] ?? 0) + 1;
        current.counts[cell] = Math.min(before + count, 0xffffffff);
        current.lastAt[cell] = Math.max(current.lastAt[cell] ?? 0, lastAt);
      });
    },
    estimate: (key) => {
      rotate();
      const occupancy = maxRowOccupancy();
      if (occupancy > SATURATION_THRESHOLD) {
        saturatedReads += 1;
        options.onAlert?.('throttle_sketch_saturated', { occupancy, saturatedReads });
        return null;
      }
      let count = Infinity;
      let last = Infinity;
      for (const cell of cells(key)) {
        count = Math.min(count, (current.counts[cell] ?? 0) + (previous.counts[cell] ?? 0));
        last = Math.min(last, Math.max(current.lastAt[cell] ?? 0, previous.lastAt[cell] ?? 0));
      }
      return count > 0 && count !== Infinity ? { count, lastAt: last } : null;
    },
    stats: () => ({ saturatedReads, maxRowOccupancy: maxRowOccupancy() }),
  };
}
