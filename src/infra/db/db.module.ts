import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { UnitOfWork } from './unit-of-work';

@Global()
@Module({
  providers: [DatabaseService, UnitOfWork],
  exports: [DatabaseService, UnitOfWork],
})
export class DbModule {}
