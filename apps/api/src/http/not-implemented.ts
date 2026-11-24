import type { FastifyReply } from 'fastify';

/** Pending endpoints answer 501 with the backlog ticket that will deliver them. */
export function sendNotImplemented(reply: FastifyReply, ticket: string, summary: string) {
  return reply.status(501).send({
    data: null,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: `${summary} is planned but not implemented yet`,
      details: { ticket },
    },
  });
}
