import { Module } from '@nestjs/common';
import { ConfigModule } from './infra/config/config.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [ConfigModule.forRoot(), HealthModule],
})
export class AppModule {}
