import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from './infra/config/config.module';
import { DbModule } from './infra/db/db.module';
import { RedisModule } from './infra/redis/redis.module';
import { CryptoModule } from './infra/crypto/crypto.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { QueueModule } from './infra/queue/queue.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { DoctorsModule } from './modules/doctors/doctors.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { ConsultationsModule } from './modules/consultations/consultations.module';
import { PrescriptionsModule } from './modules/prescriptions/prescriptions.module';
import { AuditModule } from './modules/audit/audit.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot(),
    DbModule,
    RedisModule,
    CryptoModule,
    IdempotencyModule,
    QueueModule,
    HealthModule,
    AuthModule,
    UsersModule,
    DoctorsModule,
    AvailabilityModule,
    PaymentsModule,
    BookingsModule,
    ConsultationsModule,
    PrescriptionsModule,
    AuditModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestIdInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
  ],
})
export class AppModule {}
