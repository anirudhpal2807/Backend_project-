export interface CancellationEvaluation {
  allowed: boolean;
  refundPercentage: number;
  refundAmount: number;
  cancellationFee: number;
  reason: string;
}

export class CancellationPolicyEngine {
  /**
   * Evaluates the refund amount based on cancellation policy:
   * - Doctor or Admin cancelled: 100% refund
   * - Patient cancelled:
   *   - >= 24h before appointment: 100% refund
   *   - 2h to 24h before appointment: 50% refund
   *   - < 2h before appointment: 0% refund
   */
  public static evaluate(params: {
    appointmentStart: Date;
    cancellationTime: Date;
    actorRole: 'PATIENT' | 'DOCTOR' | 'ADMIN' | 'SYSTEM';
    feeAmount: number;
  }): CancellationEvaluation {
    const { appointmentStart, cancellationTime, actorRole, feeAmount } = params;

    // Doctor/Admin or System cancellation always yields 100% refund
    if (actorRole === 'DOCTOR' || actorRole === 'ADMIN' || actorRole === 'SYSTEM') {
      return {
        allowed: true,
        refundPercentage: 100,
        refundAmount: feeAmount,
        cancellationFee: 0,
        reason: `${actorRole} cancellation provides full refund to patient`,
      };
    }

    const diffMs = appointmentStart.getTime() - cancellationTime.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours < 0) {
      // Appointment has already started or passed
      return {
        allowed: false,
        refundPercentage: 0,
        refundAmount: 0,
        cancellationFee: feeAmount,
        reason: 'Cannot cancel an appointment that has already started or passed',
      };
    }

    if (diffHours >= 24) {
      return {
        allowed: true,
        refundPercentage: 100,
        refundAmount: feeAmount,
        cancellationFee: 0,
        reason: 'Cancelled 24 or more hours before appointment: 100% refund',
      };
    }

    if (diffHours >= 2) {
      const refundAmount = Math.round((feeAmount * 50) / 100);
      const fee = feeAmount - refundAmount;
      return {
        allowed: true,
        refundPercentage: 50,
        refundAmount,
        cancellationFee: fee,
        reason: 'Cancelled between 2 and 24 hours before appointment: 50% refund',
      };
    }

    // Less than 2 hours
    return {
      allowed: true,
      refundPercentage: 0,
      refundAmount: 0,
      cancellationFee: feeAmount,
      reason: 'Cancelled less than 2 hours before appointment: 0% refund',
    };
  }
}
