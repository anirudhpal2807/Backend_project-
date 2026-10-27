import { Module } from '@nestjs/common';
import { ConfigModule } from './infra/config/config.module';

@Module({
  imports: [ConfigModule.forRoot()],
})
export class WorkerModule {}
