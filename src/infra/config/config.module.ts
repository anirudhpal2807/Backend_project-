import { DynamicModule, Global, Module } from '@nestjs/common';
import * as dotenv from 'dotenv';
import { validateEnv } from './config.schema';
import { AppConfigService } from './config.service';

@Global()
@Module({})
export class ConfigModule {
  static forRoot(customEnv?: Record<string, unknown>): DynamicModule {
    if (!customEnv) {
      dotenv.config();
    }
    const validated = validateEnv(customEnv || process.env);
    const configService = new AppConfigService(validated);

    return {
      module: ConfigModule,
      providers: [
        {
          provide: AppConfigService,
          useValue: configService,
        },
      ],
      exports: [AppConfigService],
    };
  }
}
