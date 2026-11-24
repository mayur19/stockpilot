import type { Permission, Role } from '@stockpilot/shared';
import type { Env } from './config/env.js';
import type { Db } from './db/pool.js';
import type { AuthThrottle } from './http/rate-limiter.js';

export interface AppContext {
  readonly env: Env;
  readonly db: Db;
  readonly throttle: AuthThrottle;
}

export interface AuthContext {
  readonly sessionId: string;
  readonly csrfToken: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyContextConfig {
    /** Permission required for the route; omitted means public. */
    permission?: Permission | 'authenticated';
  }
}
