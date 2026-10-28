import { Module } from '@nestjs/common';
import { DoctorsController } from './doctors.controller';
import { DoctorsService } from './doctors.service';
import { DoctorsSearchService } from './doctors-search.service';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../../infra/redis/redis.module';

@Module({
  imports: [AuthModule, RedisModule],
  controllers: [DoctorsController],
  providers: [DoctorsService, DoctorsSearchService],
  exports: [DoctorsService, DoctorsSearchService],
})
export class DoctorsModule {}
