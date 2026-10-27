import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { MockPaymentProvider } from './providers/mock-payment-provider';
import { DbModule } from '../../infra/db/db.module';
import { QueueModule } from '../../infra/queue/queue.module';
import { ConfigModule } from '../../infra/config/config.module';

@Module({
  imports: [DbModule, QueueModule, ConfigModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, MockPaymentProvider],
  exports: [PaymentsService, MockPaymentProvider],
})
export class PaymentsModule {}
