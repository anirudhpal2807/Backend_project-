import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppConfigService } from './infra/config/config.service';

async function bootstrap() {
  const adapter = new FastifyAdapter({
    logger: false, // will use pino logger interceptor/service
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
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
    `\n[API Server] Amrutam backend running on http://localhost:${port}/${prefix}\n[API Docs] Swagger documentation available at http://localhost:${port}/docs\n\n`,
  );
}

bootstrap().catch(err => {
  process.stderr.write(`[FATAL BOOT ERROR] ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
