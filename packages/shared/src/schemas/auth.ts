import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(200, 'Password must be at most 200 characters');

export const registerSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;
