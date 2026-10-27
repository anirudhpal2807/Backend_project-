import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { SagaReconciliationService } from './saga-reconciliation.service';
import { DbModule } from '../../infra/db/db.module';
import { QueueModule } from '../../infra/queue/queue.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [DbModule, QueueModule, PaymentsModule],
  controllers: [BookingsController],
  providers: [BookingsService, SagaReconciliationService],
  exports: [BookingsService, SagaReconciliationService],
})
export class BookingsModule {}
