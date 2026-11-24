import { DomainError } from './errors.js';

/**
 * Bin location codes follow ZONE-AISLE-RACK-LEVEL-POSITION, e.g. "A-03-12-2-B":
 *  - zone:     1-4 uppercase letters/digits, starting with a letter
 *  - aisle:    2 digits (01-99)
 *  - rack:     2 digits (01-99) — "bay" in some sites
 *  - level:    1 digit  (0-9), 0 = floor
 *  - position: 1 letter (A-Z)
 * Staging and dock locations use a free-form code that starts with the zone and has
 * no further segments (e.g. "RCV", "DOCK1"); those parse with `structured: false`.
 */
export interface BinAddress {
  readonly code: string;
  readonly zone: string;
  readonly structured: boolean;
  readonly aisle?: number;
  readonly rack?: number;
  readonly level?: number;
  readonly position?: string;
}

const STRUCTURED = /^([A-Z][A-Z0-9]{0,3})-(\d{2})-(\d{2})-(\d)-([A-Z])$/;
const FREE_FORM = /^[A-Z][A-Z0-9]{1,15}$/;

export function parseBinCode(raw: string): BinAddress {
  const code = raw.trim().toUpperCase();
  const match = STRUCTURED.exec(code);
  if (match) {
    const [, zone, aisle, rack, level, position] = match as unknown as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    if (Number(aisle) === 0 || Number(rack) === 0) {
      throw new DomainError('INVALID_BIN_CODE', `Aisle and rack start at 01 in "${raw}"`);
    }
    return {
      code,
      zone,
      structured: true,
      aisle: Number(aisle),
      rack: Number(rack),
      level: Number(level),
      position,
    };
  }
  if (FREE_FORM.test(code)) {
    return { code, zone: code, structured: false };
  }
  throw new DomainError(
    'INVALID_BIN_CODE',
    `"${raw}" is not a valid bin code (expected ZONE-AA-RR-L-P, e.g. A-03-12-2-B)`,
  );
}

/**
 * Default pick sequence for a structured bin: serpentine (S-shape) walk where
 * odd aisles are traversed with ascending racks and even aisles descending, so that
 * sorting by this number approximates a single pass through the zone.
 * The full pick-path optimiser (SP-100) replaces this with distance-based routing.
 */
export function defaultPickSequence(address: BinAddress): number {
  if (!address.structured) return 0;
  const aisle = address.aisle ?? 0;
  const rack = address.rack ?? 0;
  const rackOrder = aisle % 2 === 1 ? rack : 100 - rack;
  const positionIndex = (address.position ?? 'A').charCodeAt(0) - 64;
  return aisle * 100_000 + rackOrder * 1_000 + (address.level ?? 0) * 100 + positionIndex;
}
