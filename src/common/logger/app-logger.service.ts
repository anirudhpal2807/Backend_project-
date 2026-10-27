import { Injectable, LoggerService } from '@nestjs/common';
import pino from 'pino';
import { redactSensitiveData } from './redaction.util';
import { RequestContext } from '../context/request-context';

@Injectable()
export class AppLoggerService implements LoggerService {
  private readonly logger: pino.Logger;

  constructor() {
    this.logger = pino({
      level: process.env.LOG_LEVEL || 'info',
      formatters: {
        level: label => ({ level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  private enrichContext(context?: unknown): Record<string, unknown> {
    const store = RequestContext.get();
    const baseContext: Record<string, unknown> = {
      requestId: store?.requestId,
      actorId: store?.actorId,
      actorRole: store?.actorRole,
    };

    if (context && typeof context === 'object') {
      const redacted = redactSensitiveData(context) as Record<string, unknown>;
      return { ...baseContext, ...redacted };
    }

    return baseContext;
  }

  log(message: string, context?: unknown) {
    this.logger.info(this.enrichContext(context), message);
  }

  error(message: string, trace?: string, context?: unknown) {
    const meta = this.enrichContext(context);
    if (trace) meta.trace = trace;
    this.logger.error(meta, message);
  }

  warn(message: string, context?: unknown) {
    this.logger.warn(this.enrichContext(context), message);
  }

  debug(message: string, context?: unknown) {
    this.logger.debug(this.enrichContext(context), message);
  }

  verbose(message: string, context?: unknown) {
    this.logger.trace(this.enrichContext(context), message);
  }
}
