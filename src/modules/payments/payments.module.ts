import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { MockPaymentProvider } from './providers/mock-payment-provider';
import { CashfreePaymentProvider } from './providers/cashfree-payment-provider';
import { DbModule } from '../../infra/db/db.module';
import { QueueModule } from '../../infra/queue/queue.module';
import { ConfigModule } from '../../infra/config/config.module';

@Module({
  imports: [DbModule, QueueModule, ConfigModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, MockPaymentProvider, CashfreePaymentProvider],
  exports: [PaymentsService, MockPaymentProvider, CashfreePaymentProvider],
})
export class PaymentsModule {}
