import { MetricsService } from '../../src/modules/observability/metrics.service';
import { MetricsInterceptor } from '../../src/modules/observability/metrics.interceptor';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';

describe('Observability & Metrics (Unit Tests)', () => {
  let metricsService: MetricsService;
  let interceptor: MetricsInterceptor;

  beforeEach(() => {
    metricsService = new MetricsService();
    interceptor = new MetricsInterceptor(metricsService);
  });

  describe('MetricsService', () => {
    it('should initialize Prometheus registry with custom domain and RED metrics', async () => {
      metricsService.bookingsTotal.inc({ status: 'CONFIRMED' });
      metricsService.preventedDoubleBookingsTotal.inc();
      metricsService.idempotentReplaysTotal.inc({ endpoint: '/api/v1/bookings/hold' });
      metricsService.dbPoolActiveConnections.set(12);

      const metricsOutput = await metricsService.getMetrics();

      expect(metricsOutput).toContain('amrutam_bookings_total');
      expect(metricsOutput).toContain('status="CONFIRMED"');
      expect(metricsOutput).toContain('amrutam_prevented_double_bookings_total 1');
      expect(metricsOutput).toContain('amrutam_idempotent_replays_total');
      expect(metricsOutput).toContain('amrutam_db_pool_active_connections 12');
    });

    it('should record request durations in histogram buckets', async () => {
      metricsService.httpRequestDuration.observe(
        { method: 'POST', route: '/api/v1/bookings/hold', status_code: '201' },
        0.125,
      );

      const metricsOutput = await metricsService.getMetrics();
      expect(metricsOutput).toContain('amrutam_http_request_duration_seconds_bucket');
      expect(metricsOutput).toContain('route="/api/v1/bookings/hold"');
    });
  });

  describe('MetricsInterceptor', () => {
    it('should record HTTP requests and latency for standard routes', done => {
      const mockExecutionContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'GET',
            routeOptions: { url: '/api/v1/doctors/search' },
          }),
          getResponse: () => ({
            statusCode: 200,
          }),
        }),
      } as unknown as ExecutionContext;

      const mockCallHandler: CallHandler = {
        handle: () => of({ doctors: [] }),
      };

      const spyInc = jest.spyOn(metricsService.httpRequestsTotal, 'inc');
      const spyObserve = jest.spyOn(metricsService.httpRequestDuration, 'observe');

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        next: () => {
          expect(spyInc).toHaveBeenCalledWith({
            method: 'GET',
            route: '/api/v1/doctors/search',
            status_code: '200',
          });
          expect(spyObserve).toHaveBeenCalled();
          done();
        },
      });
    });

    it('should bypass duration recording on /metrics endpoint', done => {
      const mockExecutionContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'GET',
            routeOptions: { url: '/metrics' },
          }),
          getResponse: () => ({
            statusCode: 200,
          }),
        }),
      } as unknown as ExecutionContext;

      const mockCallHandler: CallHandler = {
        handle: () => of('metrics_text'),
      };

      const spyInc = jest.spyOn(metricsService.httpRequestsTotal, 'inc');

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        next: () => {
          expect(spyInc).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should record 5xx status codes when handler throws an error', done => {
      const mockExecutionContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            routeOptions: { url: '/api/v1/bookings/hold' },
          }),
          getResponse: () => ({
            statusCode: 500,
          }),
        }),
      } as unknown as ExecutionContext;

      const mockCallHandler: CallHandler = {
        handle: () => throwError(() => ({ status: 500, message: 'DB Failure' })),
      };

      const spyInc = jest.spyOn(metricsService.httpRequestsTotal, 'inc');

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        error: () => {
          expect(spyInc).toHaveBeenCalledWith(
            expect.objectContaining({
              method: 'POST',
              status_code: '500',
            }),
          );
          done();
        },
      });
    });
  });
});
