import { Module } from '@nestjs/common';
import { ConsultationsService } from './consultations.service';
import { ConsultationsController } from './consultations.controller';
import { MockVideoProvider } from './providers/mock-video-provider';
import { DbModule } from '../../infra/db/db.module';
import { QueueModule } from '../../infra/queue/queue.module';
import { CryptoModule } from '../../infra/crypto/crypto.module';

@Module({
  imports: [DbModule, QueueModule, CryptoModule],
  controllers: [ConsultationsController],
  providers: [ConsultationsService, MockVideoProvider],
  exports: [ConsultationsService, MockVideoProvider],
})
export class ConsultationsModule {}
