import {
  ConsultationStateMachine,
  VALID_TRANSITIONS,
} from '../../src/modules/bookings/domain/consultation-state-machine';
import { ConsultationStatus } from '../../src/infra/db/database.types';
import { AppException } from '../../src/common/errors/app-exception';
import { ErrorCode } from '../../src/common/errors/error-codes';

describe('ConsultationStateMachine', () => {
  describe('Valid transitions', () => {
    it.each(VALID_TRANSITIONS)(
      'should permit transition from $from to $to for authorized role $allowedRoles.0',
      ({ from, to, allowedRoles }) => {
        const primaryRole = allowedRoles[0];
        expect(() =>
          ConsultationStateMachine.assertCanTransition(from, to, primaryRole),
        ).not.toThrow();
        expect(ConsultationStateMachine.canTransition(from, to, primaryRole)).toBe(true);
      },
    );

    it('should be idempotent if currentStatus === targetStatus', () => {
      const statuses: ConsultationStatus[] = [
        'PENDING_PAYMENT',
        'CONFIRMED',
        'IN_PROGRESS',
        'COMPLETED',
        'CANCELLED',
        'EXPIRED',
        'NO_SHOW',
        'REFUNDED',
      ];

      for (const status of statuses) {
        expect(() =>
          ConsultationStateMachine.assertCanTransition(status, status, 'PATIENT'),
        ).not.toThrow();
      }
    });
  });

  describe('Illegal transitions (409 Conflict)', () => {
    const illegalTransitions: [ConsultationStatus, ConsultationStatus][] = [
      ['COMPLETED', 'CONFIRMED'],
      ['COMPLETED', 'IN_PROGRESS'],
      ['COMPLETED', 'CANCELLED'],
      ['EXPIRED', 'CONFIRMED'],
      ['EXPIRED', 'IN_PROGRESS'],
      ['REFUNDED', 'CONFIRMED'],
      ['NO_SHOW', 'IN_PROGRESS'],
      ['PENDING_PAYMENT', 'COMPLETED'],
      ['PENDING_PAYMENT', 'IN_PROGRESS'],
    ];

    it.each(illegalTransitions)(
      'should throw 409 Conflict when transitioning from %s to %s',
      (from, to) => {
        expect(() => ConsultationStateMachine.assertCanTransition(from, to, 'ADMIN')).toThrow(
          AppException,
        );

        try {
          ConsultationStateMachine.assertCanTransition(from, to, 'ADMIN');
        } catch (e) {
          const appErr = e as AppException;
          expect(appErr.getStatus()).toBe(409);
          expect(appErr.code).toBe(ErrorCode.ILLEGAL_STATE_TRANSITION);
        }
      },
    );
  });

  describe('Unauthorized role transitions (403 Forbidden)', () => {
    it('should reject PATIENT trying to transition PENDING_PAYMENT to CONFIRMED directly', () => {
      expect(() =>
        ConsultationStateMachine.assertCanTransition('PENDING_PAYMENT', 'CONFIRMED', 'PATIENT'),
      ).toThrow(AppException);

      try {
        ConsultationStateMachine.assertCanTransition('PENDING_PAYMENT', 'CONFIRMED', 'PATIENT');
      } catch (e) {
        const appErr = e as AppException;
        expect(appErr.getStatus()).toBe(403);
        expect(appErr.code).toBe(ErrorCode.FORBIDDEN);
      }
    });

    it('should reject PATIENT trying to mark consultation COMPLETED', () => {
      expect(() =>
        ConsultationStateMachine.assertCanTransition('IN_PROGRESS', 'COMPLETED', 'PATIENT'),
      ).toThrow(AppException);

      try {
        ConsultationStateMachine.assertCanTransition('IN_PROGRESS', 'COMPLETED', 'PATIENT');
      } catch (e) {
        const appErr = e as AppException;
        expect(appErr.getStatus()).toBe(403);
      }
    });
  });

  describe('isTerminal', () => {
    it('should identify terminal states correctly', () => {
      expect(ConsultationStateMachine.isTerminal('COMPLETED')).toBe(true);
      expect(ConsultationStateMachine.isTerminal('EXPIRED')).toBe(true);
      expect(ConsultationStateMachine.isTerminal('NO_SHOW')).toBe(true);
      expect(ConsultationStateMachine.isTerminal('REFUNDED')).toBe(true);

      expect(ConsultationStateMachine.isTerminal('PENDING_PAYMENT')).toBe(false);
      expect(ConsultationStateMachine.isTerminal('CONFIRMED')).toBe(false);
      expect(ConsultationStateMachine.isTerminal('IN_PROGRESS')).toBe(false);
      expect(ConsultationStateMachine.isTerminal('CANCELLED')).toBe(false);
    });
  });
});
