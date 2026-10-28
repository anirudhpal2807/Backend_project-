import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';

// Provide dummy defaults for doc export without requiring live DB or Redis
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.PORT = process.env.PORT || '3000';
process.env.API_PREFIX = process.env.API_PREFIX || 'api/v1';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_NAME = process.env.DB_NAME || 'amrutam_telemed';
process.env.DB_USER = process.env.DB_USER || 'postgres';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';
process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT || '6379';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'dev-jwt-secret-at-least-32-chars-long-example';
process.env.REFRESH_TOKEN_SECRET =
  process.env.REFRESH_TOKEN_SECRET || 'dev-refresh-token-secret-at-least-32-chars';
process.env.MASTER_ENCRYPTION_KEY =
  process.env.MASTER_ENCRYPTION_KEY ||
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.ENCRYPTION_KEY_VERSION = process.env.ENCRYPTION_KEY_VERSION || 'v1';
process.env.PAYMENT_WEBHOOK_SECRET =
  process.env.PAYMENT_WEBHOOK_SECRET || 'mock-payment-webhook-secret-32-bytes-long';

async function exportOpenApi() {
  const adapter = new FastifyAdapter();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: false,
  });

  app.setGlobalPrefix('api/v1');

  const config = new DocumentBuilder()
    .setTitle('Amrutam Telemedicine API')
    .setDescription(
      'Production-grade modular monolith backend for the Amrutam Telemedicine Platform. Implements RFC 7807 problem details, AES-256-GCM envelope encryption for PHI, rotating token families, slot hold reservation sagas, and zero double-booking guarantees.',
    )
    .setVersion('1.0.0')
    .setOpenAPIVersion('3.1.0')
    .setContact(
      'Amrutam Telemedicine Engineering',
      'https://amrutam.global',
      'engineering@amrutam.global',
    )
    .setLicense('Proprietary', 'https://amrutam.global/terms')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Provide your JWT bearer access token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'Idempotency-Key',
        in: 'header',
        description: 'Unique UUID v4 or v7 key for mutation deduplication and replay protection',
      },
      'Idempotency-Key',
    )
    .addTag('Authentication', 'User registration, login, rotating refresh tokens, and TOTP MFA')
    .addTag('Users', 'User profile management with AES-256-GCM encrypted PII fields')
    .addTag('Doctors', 'Doctor profile onboarding, verification, and slot management')
    .addTag('Availability', 'Materialized slot generation, slot blocking, and queries')
    .addTag('Consultations', 'Booking saga, consultation lifecycle, and Daily.co video room integration')
    .addTag('Prescriptions', 'Versioned immutable medical prescriptions with cryptographic hash signatures')
    .addTag('Payments', 'Stripe payment intent creation and idempotent webhook processing')
    .addTag('Audit', 'Cryptographically hash-chained immutable audit log queries and GDPR export')
    .addTag('Analytics', 'Pre-aggregated analytical rollups (revenue, utilization, funnel) with Redis caching')
    .addTag('Metrics', 'Prometheus RED metrics scraper endpoint')
    .addTag('Health', 'Kubernetes liveness and readiness probes')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  const outDir = path.resolve(__dirname, '../openapi');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const jsonPath = path.join(outDir, 'openapi.json');
  fs.writeFileSync(jsonPath, JSON.stringify(document, null, 2), 'utf-8');

  const yamlPath = path.join(outDir, 'openapi.yaml');
  const yamlContent = YAML.stringify(document);
  fs.writeFileSync(yamlPath, yamlContent, 'utf-8');

  process.stdout.write(`\n[SUCCESS] OpenAPI 3.1 specifications generated:\n  - ${jsonPath}\n  - ${yamlPath}\n\n`);

  await app.close();
}

exportOpenApi().catch(err => {
  fs.writeFileSync('export_err.log', `${err.message}\n${err.stack}\n`, 'utf-8');
  console.error('EXPORT FAILED:', err);
  process.exit(1);
});
