import { addDays, assertIsoDate, compareIsoDates } from './dates.js';
import { assertQuantity } from './quantity.js';

/**
 * Allocation engine (ADR-0010).
 *
 * Given the locked candidate stock rows for one SKU in one warehouse, decide which
 * (bin, lot) rows to reserve for a requested quantity. The function is pure: the API
 * layer locks the rows (SELECT ... FOR UPDATE), calls `planAllocation`, then persists
 * the plan in the same transaction, so the plan is always computed against a stable
 * snapshot and two concurrent orders can never reserve the same units.
 */
export const ALLOCATION_STRATEGIES = ['FEFO', 'FIFO', 'LIFO'] as const;
export type AllocationStrategy = (typeof ALLOCATION_STRATEGIES)[number];

export interface StockCandidate {
  readonly binId: string;
  readonly binCode: string;
  readonly pickSequence: number;
  readonly lotId: string;
  readonly lotCode: string;
  /** YYYY-MM-DD or null for non-perishable lots. */
  readonly expiryDate: string | null;
  /** ISO timestamp of the lot's first receipt; drives FIFO / LIFO. */
  readonly receivedAt: string;
  readonly available: number;
  /** Lots on hold (quarantine, QA) are never allocated. */
  readonly onHold?: boolean;
}

export interface AllocationRequest {
  readonly quantity: number;
  readonly strategy: AllocationStrategy;
  /** Fill-or-kill when false: either the full quantity or nothing. */
  readonly allowPartial: boolean;
  /** Today's date in the warehouse time zone, YYYY-MM-DD. */
  readonly today: string;
  /** Lots must still have at least this many days of shelf life after `today`. */
  readonly minShelfLifeDays?: number;
}

export interface AllocationPick {
  readonly binId: string;
  readonly binCode: string;
  readonly lotId: string;
  readonly lotCode: string;
  readonly expiryDate: string | null;
  readonly quantity: number;
}

export type AllocationStatus = 'FULL' | 'PARTIAL' | 'NONE';

export interface ExcludedCandidate {
  readonly binId: string;
  readonly lotId: string;
  readonly reason: 'EXPIRED' | 'SHORT_SHELF_LIFE' | 'ON_HOLD' | 'NO_AVAILABLE';
}

export interface AllocationPlan {
  readonly status: AllocationStatus;
  readonly requested: number;
  readonly allocated: number;
  readonly shortfall: number;
  readonly picks: readonly AllocationPick[];
  readonly excluded: readonly ExcludedCandidate[];
}

function exclusionReason(
  candidate: StockCandidate,
  request: AllocationRequest,
): ExcludedCandidate['reason'] | null {
  if (candidate.available <= 0) return 'NO_AVAILABLE';
  if (candidate.onHold) return 'ON_HOLD';
  if (candidate.expiryDate !== null) {
    if (compareIsoDates(candidate.expiryDate, request.today) <= 0) return 'EXPIRED';
    const minDays = request.minShelfLifeDays ?? 0;
    if (minDays > 0 && compareIsoDates(candidate.expiryDate, addDays(request.today, minDays)) < 0) {
      return 'SHORT_SHELF_LIFE';
    }
  }
  return null;
}

/** Strategy ordering at lot level. Returns <0 when `a` should be consumed first. */
export function compareByStrategy(
  strategy: AllocationStrategy,
  a: StockCandidate,
  b: StockCandidate,
): number {
  const byReceived = a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : 0;
  if (strategy === 'FEFO') {
    if (a.expiryDate !== b.expiryDate) {
      if (a.expiryDate === null) return 1;
      if (b.expiryDate === null) return -1;
      return compareIsoDates(a.expiryDate, b.expiryDate);
    }
    if (byReceived !== 0) return byReceived;
  } else {
    if (byReceived !== 0) return strategy === 'FIFO' ? byReceived : -byReceived;
  }
  return a.lotCode < b.lotCode ? -1 : a.lotCode > b.lotCode ? 1 : 0;
}

function byPickSequence(a: StockCandidate, b: StockCandidate): number {
  if (a.pickSequence !== b.pickSequence) return a.pickSequence - b.pickSequence;
  return a.binCode < b.binCode ? -1 : a.binCode > b.binCode ? 1 : 0;
}

/** Groups candidates into lots that the strategy considers equally ranked. */
function rankGroups(
  candidates: readonly StockCandidate[],
  strategy: AllocationStrategy,
): StockCandidate[][] {
  const sorted = [...candidates].sort((a, b) => compareByStrategy(strategy, a, b));
  const groups: StockCandidate[][] = [];
  for (const candidate of sorted) {
    const last = groups[groups.length - 1];
    const head = last?.[0];
    if (last && head && compareByStrategy(strategy, head, candidate) === 0) {
      last.push(candidate);
    } else {
      groups.push([candidate]);
    }
  }
  return groups;
}

/**
 * Picks bins inside one equally-ranked group so that the number of pick touches is
 * minimised:
 *  1. if one bin can cover the whole remainder, take the *smallest* such bin
 *     (best fit: it keeps larger quantities intact for full-case/pallet picks);
 *  2. otherwise drain the largest bins first, ties broken by walk sequence.
 */
function takeFromGroup(group: readonly StockCandidate[], remaining: number): AllocationPick[] {
  const toPick = (c: StockCandidate, quantity: number): AllocationPick => ({
    binId: c.binId,
    binCode: c.binCode,
    lotId: c.lotId,
    lotCode: c.lotCode,
    expiryDate: c.expiryDate,
    quantity,
  });
  const covering = group
    .filter((c) => c.available >= remaining)
    .sort((a, b) => a.available - b.available || byPickSequence(a, b));
  const single = covering[0];
  if (single) return [toPick(single, remaining)];

  const picks: AllocationPick[] = [];
  let left = remaining;
  const largestFirst = [...group].sort((a, b) => b.available - a.available || byPickSequence(a, b));
  for (const candidate of largestFirst) {
    if (left === 0) break;
    const quantity = Math.min(candidate.available, left);
    picks.push(toPick(candidate, quantity));
    left -= quantity;
  }
  return picks;
}

/**
 * Plans an allocation. Complexity: O(n log n) for n candidate rows (sorting
 * dominates; each group is scanned a constant number of times).
 */
export function planAllocation(
  request: AllocationRequest,
  candidates: readonly StockCandidate[],
): AllocationPlan {
  const requested = assertQuantity(request.quantity);
  assertIsoDate(request.today, 'today');

  const excluded: ExcludedCandidate[] = [];
  const eligible: StockCandidate[] = [];
  for (const candidate of candidates) {
    const reason = exclusionReason(candidate, request);
    if (reason) excluded.push({ binId: candidate.binId, lotId: candidate.lotId, reason });
    else eligible.push(candidate);
  }

  const picks: AllocationPick[] = [];
  let remaining = requested;
  for (const group of rankGroups(eligible, request.strategy)) {
    if (remaining === 0) break;
    const taken = takeFromGroup(group, remaining);
    for (const pick of taken) remaining -= pick.quantity;
    picks.push(...taken);
  }

  const allocated = requested - remaining;
  if (remaining > 0 && !request.allowPartial) {
    return { status: 'NONE', requested, allocated: 0, shortfall: requested, picks: [], excluded };
  }
  const status: AllocationStatus =
    allocated === requested ? 'FULL' : allocated === 0 ? 'NONE' : 'PARTIAL';
  return { status, requested, allocated, shortfall: remaining, picks, excluded };
}

export interface OrderLineRequest {
  readonly lineId: string;
  readonly skuId: string;
  readonly quantity: number;
}

export interface OrderAllocationRequest {
  readonly lines: readonly OrderLineRequest[];
  readonly strategyBySku: Readonly<Record<string, AllocationStrategy>>;
  /** When true, the whole order is all-or-nothing across every line. */
  readonly shipComplete: boolean;
  readonly today: string;
  readonly minShelfLifeDays?: number;
}

export interface OrderAllocationPlan {
  readonly status: AllocationStatus;
  readonly lines: readonly (AllocationPlan & { readonly lineId: string; readonly skuId: string })[];
}

/**
 * Plans every line of an order. Lines for the same SKU draw from a shared pool so a
 * later line cannot reuse units already planned for an earlier line.
 */
export function planOrderAllocation(
  request: OrderAllocationRequest,
  candidatesBySku: Readonly<Record<string, readonly StockCandidate[]>>,
): OrderAllocationPlan {
  const consumed = new Map<string, number>();
  const keyOf = (c: { binId: string; lotId: string }): string => `${c.binId}|${c.lotId}`;

  const lines = request.lines.map((line) => {
    const pool = (candidatesBySku[line.skuId] ?? []).map((c) => ({
      ...c,
      available: c.available - (consumed.get(keyOf(c)) ?? 0),
    }));
    const plan = planAllocation(
      {
        quantity: line.quantity,
        strategy: request.strategyBySku[line.skuId] ?? 'FEFO',
        allowPartial: !request.shipComplete,
        today: request.today,
        ...(request.minShelfLifeDays !== undefined
          ? { minShelfLifeDays: request.minShelfLifeDays }
          : {}),
      },
      pool,
    );
    for (const pick of plan.picks) {
      consumed.set(keyOf(pick), (consumed.get(keyOf(pick)) ?? 0) + pick.quantity);
    }
    return { ...plan, lineId: line.lineId, skuId: line.skuId };
  });

  const anyShort = lines.some((line) => line.status !== 'FULL');
  if (request.shipComplete && anyShort) {
    return {
      status: 'NONE',
      lines: lines.map((line) => ({
        ...line,
        status: 'NONE' as const,
        allocated: 0,
        shortfall: line.requested,
        picks: [],
      })),
    };
  }
  const total = lines.reduce((sum, line) => sum + line.allocated, 0);
  const status: AllocationStatus = !anyShort ? 'FULL' : total === 0 ? 'NONE' : 'PARTIAL';
  return { status, lines };
}
