import { Module } from '@nestjs/common';
import { PrescriptionsService } from './prescriptions.service';
import { PrescriptionsController } from './prescriptions.controller';
import { DbModule } from '../../infra/db/db.module';
import { QueueModule } from '../../infra/queue/queue.module';
import { CryptoModule } from '../../infra/crypto/crypto.module';

@Module({
  imports: [DbModule, QueueModule, CryptoModule],
  controllers: [PrescriptionsController],
  providers: [PrescriptionsService],
  exports: [PrescriptionsService],
})
export class PrescriptionsModule {}
