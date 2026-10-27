import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrapWorker() {
  process.stdout.write(
    '\n[Worker Process] Initializing Amrutam Telemedicine Background Worker...\n',
  );
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  const shutdown = async (signal: string) => {
    process.stdout.write(
      `\n[Worker Process] Received ${signal}. Draining queues and shutting down gracefully...\n`,
    );
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.stdout.write('[Worker Process] Background worker is running and listening for jobs.\n\n');
}

bootstrapWorker().catch(err => {
  process.stderr.write(`[FATAL WORKER ERROR] ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
