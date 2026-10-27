import { Injectable } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { AppLoggerService } from '../../common/logger/app-logger.service';

@Injectable()
export class SagaReconciliationService {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * Periodic reconciliation job:
   * - Detects stuck PENDING_PAYMENT holds that expired without payment
   * - Restores availability slots to OPEN
   * - Marks consultations EXPIRED
   */
  public async reconcileExpiredHolds(): Promise<{ reapedHolds: number }> {
    this.logger.log('Starting saga reconciliation check for expired holds');
    const reapedHolds = await this.bookingsService.reapExpiredHolds();
    this.logger.log(`Saga reconciliation completed. Reaped holds: ${reapedHolds}`);
    return { reapedHolds };
  }
}
