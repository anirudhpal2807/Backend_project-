import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, of } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import * as crypto from 'crypto';
import { IDEMPOTENT_METADATA_KEY, IdempotentOptions } from './idempotency.decorator';
import { IdempotencyStore } from './idempotency.store';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';
import { RequestContext } from '../context/request-context';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly store: IdempotencyStore,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const options = this.reflector.get<IdempotentOptions | undefined>(
      IDEMPOTENT_METADATA_KEY,
      context.getHandler(),
    );

    // If endpoint is not decorated with @Idempotent(), proceed normally
    if (!options) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const res = http.getResponse<FastifyReply>();

    const rawKey = req.headers['idempotency-key'];
    if (!rawKey || typeof rawKey !== 'string' || rawKey.trim().length === 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.IDEMPOTENCY_KEY_MISSING,
        'Idempotency-Key header is required for this operation.',
      );
    }

    const idempotencyKey = rawKey.trim();
    const scope = options.scope || req.url;
    const userId = RequestContext.getActorId();

    // Fingerprint calculation (SHA-256 hash of normalized body)
    const bodyString = req.body ? JSON.stringify(req.body) : '';
    const fingerprint = crypto.createHash('sha256').update(bodyString).digest('hex');

    const result = await this.store.acquire(
      idempotencyKey,
      scope,
      fingerprint,
      userId,
      options.ttlSeconds,
    );

    if (!result.acquired && result.record) {
      const record = result.record;

      if (record.status === 'IN_FLIGHT') {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.IDEMPOTENCY_IN_FLIGHT,
          'A request with this Idempotency-Key is already currently being processed.',
          undefined,
          2, // Retry-After 2 seconds
        );
      }

      if (record.status === 'COMPLETED') {
        if (record.requestFingerprint !== fingerprint) {
          throw new AppException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            ErrorCode.IDEMPOTENCY_PAYLOAD_MISMATCH,
            'Idempotency-Key has already been used with a different request payload.',
          );
        }

        // Replay stored response!
        res.header('Idempotent-Replayed', 'true');
        res.header('X-Idempotency-Key', idempotencyKey);
        res.status(record.responseStatus || 200);

        const parsedBody = record.responseBody ? JSON.parse(record.responseBody) : {};
        return of(parsedBody);
      }
    }

    // New request: process and cache response
    return next.handle().pipe(
      tap(async body => {
        const statusCode = res.statusCode || 200;
        await this.store.saveResponse(
          idempotencyKey,
          scope,
          statusCode,
          JSON.stringify(body),
          userId,
        );
      }),
      catchError(async err => {
        await this.store.markFailed(idempotencyKey, scope, userId);
        throw err;
      }),
    );
  }
}
