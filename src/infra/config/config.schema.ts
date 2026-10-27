import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_PREFIX: z.string().default('api/v1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Database
  DB_HOST: z.string().min(1, 'DB_HOST is required'),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().min(1, 'DB_NAME is required'),
  DB_USER: z.string().min(1, 'DB_USER is required'),
  DB_PASSWORD: z.string().default(''),
  DB_POOL_MIN: z.coerce.number().default(2),
  DB_POOL_MAX: z.coerce.number().default(20),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().default(5000),

  // Redis
  REDIS_HOST: z.string().min(1, 'REDIS_HOST is required'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  // Security
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  JWT_EXPIRES_IN: z.string().default('900s'),
  REFRESH_TOKEN_SECRET: z
    .string()
    .min(32, 'REFRESH_TOKEN_SECRET must be at least 32 characters long'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),
  MASTER_ENCRYPTION_KEY: z
    .string()
    .length(64, 'MASTER_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)'),
  ENCRYPTION_KEY_VERSION: z.string().default('v1'),

  // Payment Webhook
  PAYMENT_WEBHOOK_SECRET: z.string().min(16, 'PAYMENT_WEBHOOK_SECRET is required'),

  // Telemetry
  OTEL_SERVICE_NAME: z.string().default('amrutam-telemedicine-backend'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export function validateEnv(rawEnv: Record<string, unknown>): EnvConfig {
  const result = EnvSchema.safeParse(rawEnv);
  if (!result.success) {
    const errorDetails = result.error.errors
      .map(err => `${err.path.join('.')}: ${err.message}`)
      .join('\n  - ');
    throw new Error(`\n[FATAL CONFIG ERROR] Environment validation failed:\n  - ${errorDetails}\n`);
  }
  return result.data;
}
