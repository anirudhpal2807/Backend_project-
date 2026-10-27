import { HttpStatus } from '@nestjs/common';
import { ConsultationStatus } from '../../../infra/db/database.types';
import { AppException } from '../../../common/errors/app-exception';
import { ErrorCode } from '../../../common/errors/error-codes';

export interface StateTransitionContext {
  actorRole: 'PATIENT' | 'DOCTOR' | 'ADMIN' | 'SYSTEM';
  actorId: string;
  reason?: string;
  timestamp: Date;
}

export interface TransitionRule {
  from: ConsultationStatus;
  to: ConsultationStatus;
  allowedRoles: ('PATIENT' | 'DOCTOR' | 'ADMIN' | 'SYSTEM')[];
  description: string;
}

export const VALID_TRANSITIONS: TransitionRule[] = [
  // PENDING_PAYMENT transitions
  {
    from: 'PENDING_PAYMENT',
    to: 'CONFIRMED',
    allowedRoles: ['SYSTEM', 'ADMIN'],
    description: 'Payment successfully captured',
  },
  {
    from: 'PENDING_PAYMENT',
    to: 'EXPIRED',
    allowedRoles: ['SYSTEM'],
    description: '10-minute hold window expired without payment',
  },
  {
    from: 'PENDING_PAYMENT',
    to: 'CANCELLED',
    allowedRoles: ['PATIENT', 'ADMIN', 'SYSTEM'],
    description: 'Patient cancelled booking before paying',
  },

  // CONFIRMED transitions
  {
    from: 'CONFIRMED',
    to: 'IN_PROGRESS',
    allowedRoles: ['DOCTOR', 'ADMIN'],
    description: 'Doctor started the video consultation',
  },
  {
    from: 'CONFIRMED',
    to: 'CANCELLED',
    allowedRoles: ['PATIENT', 'DOCTOR', 'ADMIN'],
    description: 'Consultation cancelled prior to start',
  },
  {
    from: 'CONFIRMED',
    to: 'NO_SHOW',
    allowedRoles: ['DOCTOR', 'ADMIN', 'SYSTEM'],
    description: 'Patient did not join scheduled consultation',
  },
  {
    from: 'CONFIRMED',
    to: 'REFUNDED',
    allowedRoles: ['SYSTEM', 'ADMIN'],
    description: 'Direct refund before consultation started',
  },

  // IN_PROGRESS transitions
  {
    from: 'IN_PROGRESS',
    to: 'COMPLETED',
    allowedRoles: ['DOCTOR', 'ADMIN'],
    description: 'Consultation concluded normally by doctor',
  },
  {
    from: 'IN_PROGRESS',
    to: 'CANCELLED',
    allowedRoles: ['DOCTOR', 'ADMIN'],
    description: 'Doctor aborted consultation due to technical or clinical reasons',
  },

  // CANCELLED transitions
  {
    from: 'CANCELLED',
    to: 'REFUNDED',
    allowedRoles: ['SYSTEM', 'ADMIN'],
    description: 'Refund processed following cancellation',
  },
];

export class ConsultationStateMachine {
  /**
   * Evaluates if a transition is allowed and throws AppException(409 Conflict) if illegal.
   */
  public static assertCanTransition(
    currentStatus: ConsultationStatus,
    targetStatus: ConsultationStatus,
    actorRole: 'PATIENT' | 'DOCTOR' | 'ADMIN' | 'SYSTEM',
  ): void {
    if (currentStatus === targetStatus) {
      return; // No-op idempotent transition
    }

    const rule = VALID_TRANSITIONS.find(t => t.from === currentStatus && t.to === targetStatus);

    if (!rule) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.ILLEGAL_STATE_TRANSITION,
        `Cannot transition consultation from '${currentStatus}' to '${targetStatus}'. Transition is not permitted.`,
      );
    }

    if (!rule.allowedRoles.includes(actorRole)) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        `Actor role '${actorRole}' is not authorized to transition consultation from '${currentStatus}' to '${targetStatus}'. Allowed: ${rule.allowedRoles.join(', ')}`,
      );
    }
  }

  public static canTransition(
    currentStatus: ConsultationStatus,
    targetStatus: ConsultationStatus,
    actorRole: 'PATIENT' | 'DOCTOR' | 'ADMIN' | 'SYSTEM',
  ): boolean {
    try {
      this.assertCanTransition(currentStatus, targetStatus, actorRole);
      return true;
    } catch {
      return false;
    }
  }

  public static isTerminal(status: ConsultationStatus): boolean {
    return ['COMPLETED', 'EXPIRED', 'NO_SHOW', 'REFUNDED'].includes(status);
  }
}
