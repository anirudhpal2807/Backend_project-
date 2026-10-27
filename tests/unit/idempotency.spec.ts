import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { IdempotencyInterceptor } from '../../src/common/idempotency/idempotency.interceptor';
import { IdempotencyStore } from '../../src/common/idempotency/idempotency.store';
import { AppException } from '../../src/common/errors/app-exception';
import { ErrorCode } from '../../src/common/errors/error-codes';
import { FastifyReply, FastifyRequest } from 'fastify';

describe('Idempotency Module (T-033 - Critical Auto-Fail Gate)', () => {
  let interceptor: IdempotencyInterceptor;
  let store: IdempotencyStore;
  let reflector: Reflector;

  beforeEach(() => {
    store = new IdempotencyStore();
    reflector = new Reflector();
    interceptor = new IdempotencyInterceptor(reflector, store);
  });

  function createMockContext(
    headers: Record<string, string>,
    body: Record<string, unknown>,
  ): {
    context: ExecutionContext;
    mockReply: Partial<FastifyReply>;
  } {
    const mockReply: Partial<FastifyReply> = {
      header: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      statusCode: 201,
    };

    const mockRequest: Partial<FastifyRequest> = {
      headers,
      body,
      url: '/api/v1/bookings',
    };

    const context = {
      getHandler: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => mockRequest as FastifyRequest,
        getResponse: () => mockReply as FastifyReply,
      }),
    } as unknown as ExecutionContext;

    return { context, mockReply };
  }

  it('rejects mutating idempotent endpoint when Idempotency-Key header is missing', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({ scope: 'booking' });
    const { context } = createMockContext({}, { slotId: 'slot-123' });
    const next: CallHandler = { handle: () => of({ success: true }) };

    await expect(interceptor.intercept(context, next)).rejects.toThrow(
      expect.objectContaining({
        code: ErrorCode.IDEMPOTENCY_KEY_MISSING,
      }),
    );
  });

  it('executes handler and saves response for first attempt', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({ scope: 'booking' });
    const { context } = createMockContext(
      { 'idempotency-key': 'idem-key-1' },
      { slotId: 'slot-123' },
    );

    const next: CallHandler = { handle: () => of({ bookingId: 'b-999', status: 'HELD' }) };
    const observable = await interceptor.intercept(context, next);

    const result = await new Promise(resolve => observable.subscribe(resolve));
    expect(result).toEqual({ bookingId: 'b-999', status: 'HELD' });
  });

  it('replays identical stored response with Idempotent-Replayed header on duplicate call', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({ scope: 'booking' });
    const { context: ctx1 } = createMockContext(
      { 'idempotency-key': 'idem-key-replay' },
      { slotId: 'slot-123' },
    );
    const next1: CallHandler = {
      handle: () => of({ bookingId: 'b-replayed', status: 'CONFIRMED' }),
    };
    const obs1 = await interceptor.intercept(ctx1, next1);
    await new Promise(resolve => obs1.subscribe(resolve));

    // Second call with same key and identical body
    const { context: ctx2, mockReply: reply2 } = createMockContext(
      { 'idempotency-key': 'idem-key-replay' },
      { slotId: 'slot-123' },
    );
    const handlerCalled = jest.fn();
    const next2: CallHandler = { handle: handlerCalled };

    const obs2 = await interceptor.intercept(ctx2, next2);
    const result2 = await new Promise(resolve => obs2.subscribe(resolve));

    // Must NOT call handler again!
    expect(handlerCalled).not.toHaveBeenCalled();
    expect(reply2.header).toHaveBeenCalledWith('Idempotent-Replayed', 'true');
    expect(result2).toEqual({ bookingId: 'b-replayed', status: 'CONFIRMED' });
  });

  it('rejects duplicate key with different payload with 422 IDEMPOTENCY_PAYLOAD_MISMATCH', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({ scope: 'booking' });
    const { context: ctx1 } = createMockContext(
      { 'idempotency-key': 'idem-key-mismatch' },
      { slotId: 'slot-AAA' },
    );
    const next1: CallHandler = { handle: () => of({ bookingId: 'b-1' }) };
    const obs1 = await interceptor.intercept(ctx1, next1);
    await new Promise(resolve => obs1.subscribe(resolve));

    // Call with SAME key but DIFFERENT payload
    const { context: ctx2 } = createMockContext(
      { 'idempotency-key': 'idem-key-mismatch' },
      { slotId: 'slot-BBB' },
    );
    const next2: CallHandler = { handle: () => of({ bookingId: 'b-2' }) };

    await expect(interceptor.intercept(ctx2, next2)).rejects.toThrow(
      expect.objectContaining({
        code: ErrorCode.IDEMPOTENCY_PAYLOAD_MISMATCH,
      }),
    );
  });

  it('rejects in-flight request on same key with 409 and Retry-After', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({ scope: 'booking' });

    // Manually mark in-flight in store
    await store.acquire('idem-in-flight', 'booking', 'hash-123');

    const { context } = createMockContext({ 'idempotency-key': 'idem-in-flight' }, { test: 123 });
    const next: CallHandler = { handle: () => of({}) };

    try {
      await interceptor.intercept(context, next);
      fail('Expected 409 exception');
    } catch (err) {
      const appEx = err as AppException;
      expect(appEx.getStatus()).toBe(409);
      expect(appEx.code).toBe(ErrorCode.IDEMPOTENCY_IN_FLIGHT);
      expect(appEx.retryAfterSeconds).toBe(2);
    }
  });
});
