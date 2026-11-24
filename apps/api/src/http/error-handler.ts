import { DomainError } from '@stockpilot/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError, fromDomainError, fromPgError } from './errors.js';

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof DomainError) return fromDomainError(error);
  const fastifyError = error as FastifyError & { code?: string; constraint?: string };
  const pgMapped = fromPgError(fastifyError);
  if (pgMapped) return pgMapped;
  if (fastifyError.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
    return new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }
  if (fastifyError.statusCode && fastifyError.statusCode >= 400 && fastifyError.statusCode < 500) {
    return new AppError(fastifyError.statusCode, 'BAD_REQUEST', fastifyError.message);
  }
  return new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}

/** Central error handler: every failure leaves the API as the standard envelope. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const appError = toAppError(error);
    if (appError.status >= 500) {
      request.log.error({ err: error }, 'request failed');
    } else {
      request.log.info({ code: appError.code, status: appError.status }, 'request rejected');
    }
    const body: { code: string; message: string; details?: unknown } = {
      code: appError.code,
      message: appError.message,
    };
    if (appError.details !== undefined) body.details = appError.details;
    const retryAfter = (appError.details as { retryAfterSeconds?: number } | undefined)
      ?.retryAfterSeconds;
    if (appError.status === 429 && retryAfter) void reply.header('retry-after', String(retryAfter));
    void reply.status(appError.status).send({ data: null, error: body });
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      data: null,
      error: { code: 'ROUTE_NOT_FOUND', message: `No route for ${request.method} ${request.url}` },
    });
  });
}
