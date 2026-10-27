import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { LocalKmsService } from './local-kms.service';
import { KMS_TOKEN } from './kms.interface';

@Global()
@Module({
  providers: [
    {
      provide: KMS_TOKEN,
      useClass: LocalKmsService,
    },
    CryptoService,
  ],
  exports: [KMS_TOKEN, CryptoService],
})
export class CryptoModule {}
