/**
 * Error raised by pure domain logic when an invariant would be violated.
 * The API layer maps `code` to an HTTP status (see apps/api/src/http/errors.ts).
 */
export type DomainErrorCode =
  | 'INVALID_QUANTITY'
  | 'INVALID_UOM'
  | 'NON_INTEGRAL_CONVERSION'
  | 'INVALID_UOM_LADDER'
  | 'INVALID_BIN_CODE'
  | 'INSUFFICIENT_AVAILABLE'
  | 'INSUFFICIENT_ALLOCATED'
  | 'INVALID_MOVEMENT'
  | 'INVALID_DATE';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details ? Object.freeze({ ...details }) : undefined;
  }
}
