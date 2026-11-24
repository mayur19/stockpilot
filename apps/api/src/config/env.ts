import { z } from 'zod';

/** Zod-validated process configuration (ADR-0004). Fails fast at startup. */
export type TrustProxy = false | number | string[];
const PROXY_ENTRY = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]+)(?:\/\d{1,3})?$/;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4103),
  APP_ORIGIN: z.string().url().default('http://localhost:5103'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  LOGIN_BACKOFF_BASE_SECONDS: z.coerce.number().int().min(1).max(3600).default(30),
  LOGIN_IP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10_000).default(50),
  LOGIN_IP_MAX_EMAILS: z.coerce.number().int().min(1).max(10_000).default(20),
  REGISTER_IP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(1000).default(10),
  /**
   * Reverse-proxy trust for X-Forwarded-For: "false" (default), a hop count such as
   * "1", or a comma-separated list of proxy IPs/CIDRs. "true" is rejected because it
   * would let any client spoof its IP and bypass the per-IP throttles.
   */
  TRUST_PROXY: z
    .string()
    .trim()
    .optional()
    .transform((input, issue): TrustProxy => {
      const value = input ?? 'false';
      if (value === '' || value === 'false') return false;
      if (/^\d{1,2}$/.test(value)) return Number(value);
      const entries = value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (
        value !== 'true' &&
        entries.length > 0 &&
        entries.every((entry) => PROXY_ENTRY.test(entry))
      ) {
        return entries;
      }
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'TRUST_PROXY must be false, a hop count, or a comma-separated list of IPs/CIDRs',
      });
      return z.NEVER;
    }),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && source.TRUST_PROXY === undefined) {
    throw new Error(
      'Invalid configuration: TRUST_PROXY must be set explicitly in production (false, a hop count, or proxy IPs/CIDRs)',
    );
  }
  if (parsed.data.NODE_ENV === 'production' && /replace-me/.test(parsed.data.SESSION_SECRET)) {
    throw new Error('Invalid configuration: SESSION_SECRET still has the placeholder value');
  }
  return parsed.data;
}
