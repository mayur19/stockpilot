import { DomainError } from './errors.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates a calendar date in YYYY-MM-DD form (no time zone; expiry is a date). */
export function assertIsoDate(value: string, field = 'date'): string {
  if (!ISO_DATE.test(value)) {
    throw new DomainError('INVALID_DATE', `${field} must be YYYY-MM-DD`, { field, value });
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new DomainError('INVALID_DATE', `${field} is not a real calendar date`, {
      field,
      value,
    });
  }
  return value;
}

export function addDays(isoDate: string, days: number): string {
  const base = new Date(`${assertIsoDate(isoDate)}T00:00:00Z`);
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Lexicographic comparison is valid for YYYY-MM-DD strings. */
export function compareIsoDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
