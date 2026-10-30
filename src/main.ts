import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppConfigService } from './infra/config/config.service';

import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import * as path from 'path';

async function bootstrap() {
  const adapter = new FastifyAdapter({
    logger: false,
    ignoreTrailingSlash: true,
    bodyLimit: 1048576, // 1MB body limit (T-120)
    trustProxy: true, // trust upstream ALB proxy (T-120)
    connectionTimeout: 15000, // 15s request timeout (T-120)
    keepAliveTimeout: 5000,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });

  // Security Headers via Helmet (T-120)
  await app.register(helmet as unknown as Parameters<typeof app.register>[0], {
    contentSecurityPolicy: false,
    frameguard: { action: 'deny' },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  });

  // Serve Testing Portal UI at /portal/
  await app.register(fastifyStatic as unknown as Parameters<typeof app.register>[0], {
    root: path.join(process.cwd(), 'public'),
    prefix: '/portal/',
    decorateReply: false,
  });

  // Redirect root / to Testing Portal
  const fastify = app.getHttpAdapter().getInstance();
  fastify.get('/', (_req: any, reply: any) => {
    reply.redirect('/portal/index.html');
  });

  // Permissive CORS for development & API portal testing
  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'x-request-id',
      'traceparent',
      'x-signature',
    ],
  });

  const configService = app.get(AppConfigService);
  const port = configService.get('PORT') || 3000;
  const prefix = configService.get('API_PREFIX') || 'api/v1';

  app.setGlobalPrefix(prefix);
  app.enableShutdownHooks();

  // OpenAPI Swagger Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Amrutam Telemedicine API')
    .setDescription('Production-grade backend API for Amrutam Telemedicine System')
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter your JWT access token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'Idempotency-Key',
        in: 'header',
        description: 'Unique UUID key for write request deduplication and replay safety',
      },
      'Idempotency-Key',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(port, '0.0.0.0');
  process.stdout.write(
    `\n[API Server] Amrutam backend running on http://localhost:${port}/${prefix}\n[API Docs] Swagger documentation available at http://localhost:${port}/docs\n[Testing Portal] Interactive Frontend available at http://localhost:${port}/portal/index.html\n\n`,
  );
}

bootstrap().catch(err => {
  process.stderr.write(`[FATAL BOOT ERROR] ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
