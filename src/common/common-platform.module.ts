import { Global, Module } from '@nestjs/common';
import { AppLoggerService } from './logger/app-logger.service';
import { UuidV7IdGenerator } from './id/uuidv7-id-generator';
import { SystemClock } from './clock/system-clock';

@Global()
@Module({
  providers: [AppLoggerService, UuidV7IdGenerator, SystemClock],
  exports: [AppLoggerService, UuidV7IdGenerator, SystemClock],
})
export class CommonPlatformModule {}
