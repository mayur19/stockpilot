import { DomainError, type DomainErrorCode } from '@stockpilot/shared';

/** Application error with a stable machine-readable code and HTTP status. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'VALIDATION_FAILED', message, details);
export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (entity: string) => new AppError(404, 'NOT_FOUND', `${entity} not found`);
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);

const DOMAIN_STATUS: Record<DomainErrorCode, number> = {
  INVALID_QUANTITY: 400,
  INVALID_UOM: 400,
  NON_INTEGRAL_CONVERSION: 400,
  INVALID_UOM_LADDER: 400,
  INVALID_BIN_CODE: 400,
  INVALID_DATE: 400,
  INVALID_MOVEMENT: 400,
  INSUFFICIENT_AVAILABLE: 409,
  INSUFFICIENT_ALLOCATED: 409,
};

export function fromDomainError(error: DomainError): AppError {
  return new AppError(DOMAIN_STATUS[error.code], error.code, error.message, error.details);
}

/** Maps well-known PostgreSQL error codes raised by constraints to API errors. */
export function fromPgError(error: { code?: string; constraint?: string }): AppError | null {
  switch (error.code) {
    case '23505':
      return conflict('ALREADY_EXISTS', 'A record with the same unique key already exists', {
        constraint: error.constraint,
      });
    case '23514':
      return conflict('CONSTRAINT_VIOLATION', 'The change would violate a stock invariant', {
        constraint: error.constraint,
      });
    case '23503':
      return badRequest('A referenced record does not exist', { constraint: error.constraint });
    case '40P01':
    case '40001':
      return new AppError(503, 'CONCURRENCY_RETRY', 'Concurrent update detected, please retry');
    default:
      return null;
  }
}
