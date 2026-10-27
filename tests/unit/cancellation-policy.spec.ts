import { CancellationPolicyEngine } from '../../src/modules/bookings/domain/cancellation-policy';

describe('CancellationPolicyEngine', () => {
  const appointmentStart = new Date('2026-11-01T10:00:00Z');
  const feeAmount = 1000;

  it('should grant 100% refund if cancelled 25 hours before appointment by patient', () => {
    const cancellationTime = new Date('2026-10-31T09:00:00Z'); // 25 hours before
    const result = CancellationPolicyEngine.evaluate({
      appointmentStart,
      cancellationTime,
      actorRole: 'PATIENT',
      feeAmount,
    });

    expect(result.allowed).toBe(true);
    expect(result.refundPercentage).toBe(100);
    expect(result.refundAmount).toBe(1000);
    expect(result.cancellationFee).toBe(0);
  });

  it('should grant 50% refund if cancelled 10 hours before appointment by patient', () => {
    const cancellationTime = new Date('2026-11-01T00:00:00Z'); // 10 hours before
    const result = CancellationPolicyEngine.evaluate({
      appointmentStart,
      cancellationTime,
      actorRole: 'PATIENT',
      feeAmount,
    });

    expect(result.allowed).toBe(true);
    expect(result.refundPercentage).toBe(50);
    expect(result.refundAmount).toBe(500);
    expect(result.cancellationFee).toBe(500);
  });

  it('should grant 0% refund if cancelled 1 hour before appointment by patient', () => {
    const cancellationTime = new Date('2026-11-01T09:00:00Z'); // 1 hour before
    const result = CancellationPolicyEngine.evaluate({
      appointmentStart,
      cancellationTime,
      actorRole: 'PATIENT',
      feeAmount,
    });

    expect(result.allowed).toBe(true);
    expect(result.refundPercentage).toBe(0);
    expect(result.refundAmount).toBe(0);
    expect(result.cancellationFee).toBe(1000);
  });

  it('should grant 100% refund if cancelled by DOCTOR regardless of time', () => {
    const cancellationTime = new Date('2026-11-01T09:45:00Z'); // 15 mins before
    const result = CancellationPolicyEngine.evaluate({
      appointmentStart,
      cancellationTime,
      actorRole: 'DOCTOR',
      feeAmount,
    });

    expect(result.allowed).toBe(true);
    expect(result.refundPercentage).toBe(100);
    expect(result.refundAmount).toBe(1000);
    expect(result.cancellationFee).toBe(0);
  });

  it('should grant 100% refund if cancelled by ADMIN regardless of time', () => {
    const cancellationTime = new Date('2026-11-01T09:55:00Z');
    const result = CancellationPolicyEngine.evaluate({
      appointmentStart,
      cancellationTime,
      actorRole: 'ADMIN',
      feeAmount,
    });

    expect(result.allowed).toBe(true);
    expect(result.refundPercentage).toBe(100);
    expect(result.refundAmount).toBe(1000);
  });

  it('should not allow cancellation if appointment already started', () => {
    const cancellationTime = new Date('2026-11-01T10:15:00Z'); // 15 mins after start
    const result = CancellationPolicyEngine.evaluate({
      appointmentStart,
      cancellationTime,
      actorRole: 'PATIENT',
      feeAmount,
    });

    expect(result.allowed).toBe(false);
  });
});
